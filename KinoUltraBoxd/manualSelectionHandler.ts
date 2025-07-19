import { Telegraf, Context, Markup } from 'telegraf';
import { BotSessionState } from './models/SessionModels';
import { FilmData, PotentialMatch } from './models/FilmData';
import { sessionManager } from './services/sessionManager';
// Completion callback will be supplied by bot.ts -- allows decoupling orchestration

// Callback provided by the bot layer; invoked once the user finishes all selections
let onSelectionComplete: ((ctx: Context, films: FilmData[]) => Promise<void> | void) | undefined;

// Local helpers to access the persisted session state
const loadState = (userId: number) => sessionManager.get(userId);
const saveState = (userId: number, state: BotSessionState) => sessionManager.set(userId, state);

// --- Lower-level helpers ---------------------------------------------------

async function promptSingleMatch(
  ctx: Context,
  filmIdx: number,
  film: FilmData,
  match: PotentialMatch,
  allowSkipAll: boolean, // NEW PARAM
): Promise<void> {
  const filmYearPart = film.year ? `(${film.year})` : '';
  const matchYearPart = match.year ? `(${match.year})` : '';
  const descrPart = match.description ? `\n${match.description}` : '';

  const header = `👀 Я нашел только одно подходящее совпадение для фильма [${film.title} ${filmYearPart}](${film.kinopoiskUrl})`;
  const candidateLine = `[${match.title} ${matchYearPart}](${match.tmdbUrl})\n${descrPart}`;

  const keyboardButtons: any[] = [
    [Markup.button.callback('✅ Да, это он', `single_yes_${filmIdx}`)],
    [Markup.button.callback('❌ Нет, это не он', `single_no_${filmIdx}`)],
  ];

  if (allowSkipAll) {
    // Add a dedicated row for skipping the rest of the queue
    keyboardButtons.push([
      Markup.button.callback('🛑 Пропустить все', 'skip_all'),
    ]);
  }

  const keyboard = Markup.inlineKeyboard(keyboardButtons);

  // Use Markdown parse mode to ensure formatting (bold, links) renders correctly
  await ctx.replyWithMarkdown(`${header}\n\n${candidateLine}`, keyboard);
}

async function promptMultiMatch(
  ctx: Context,
  filmIdx: number,
  film: FilmData,
  matches: PotentialMatch[],
  allowSkipAll: boolean, // NEW PARAM
): Promise<void> {
  const filmYearPart = film.year ? `(${film.year})` : '';
  const lines: string[] = [
    `👀 Я нашел несколько подходящих совпадений для фильма [${film.title} ${filmYearPart}](${film.kinopoiskUrl})`,
  ];
  matches.forEach((m, idx) => {
    const yearPart = m.year ? `(${m.year})` : '';
    const descrPart = m.description ? `\n${m.description}` : '';
    lines.push(`${idx + 1}. [${m.title} ${yearPart}](${m.tmdbUrl})${descrPart}`);
  });

  const numberButtons = matches.map((_, idx) =>
    Markup.button.callback(String(idx + 1), `choose_${filmIdx}_${idx}`),
  );

  const keyboardRows: any[][] = [];

  // Rows for number buttons – 3 per row for better UX
  for (let i = 0; i < numberButtons.length; i += 3) {
    keyboardRows.push(numberButtons.slice(i, i + 3));
  }

  // Row with single-film skip
  keyboardRows.push([Markup.button.callback('❌ Пропустить', `multi_skip_${filmIdx}`)]);

  // Row with skip-all when allowed
  if (allowSkipAll) {
    keyboardRows.push([Markup.button.callback('🛑 Пропустить все', 'skip_all')]);
  }

  const keyboard = Markup.inlineKeyboard(keyboardRows);

  // Use Markdown parse mode for proper rich formatting of the list
  // Separate each candidate line with an extra newline for readability
  await ctx.replyWithMarkdown(lines.join('\n\n'), keyboard);
}

/**
 * Sends an inline-keyboard prompt asking the user to pick the correct film
 * match from the previously fetched TMDB candidates.
 */
export async function promptNextFilm(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  const session = await loadState(userId);
  const state = session.selection;
  if (!state) return;

  // Completed all selections → cleanup and notify user
  if (state.currentIdx >= state.selectionQueue.length) {

    // Clear selection state first, so the callback sees a clean session if needed
    await sessionManager.clearSelection(userId);

    // Let the orchestrator know that we're done and pass enriched film list
    if (onSelectionComplete) {
      await onSelectionComplete(ctx, state.films);
    }
    return;
  }

  const filmIdx = state.selectionQueue[state.currentIdx];
  const film = state.films[filmIdx];
  const matches = film.potentialMatches ?? [];

  const remaining = state.selectionQueue.length - state.currentIdx;
  const allowSkipAll = remaining > 1; // Show global skip when >3 films remain

  if (matches.length === 1) {
    await promptSingleMatch(ctx, filmIdx, film, matches[0], allowSkipAll);
    return;
  }

  await promptMultiMatch(ctx, filmIdx, film, matches, allowSkipAll);
}

/**
 * Registers the inline-button callback with the supplied Telegraf instance so
 * users can select a film during the manual disambiguation wizard.
 */
export function registerSelectionHandler(
  bot: Telegraf<Context>,
  onComplete?: (ctx: Context, films: FilmData[]) => Promise<void> | void,
): void {
  onSelectionComplete = onComplete;
  bot.action(/^choose_(\d+)_(\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const session = await loadState(userId);
    const state = session.selection;
    if (!state) {
      await ctx.answerCbQuery('Нет активного выбора.');
      return;
    }

    const filmIdx = Number(ctx.match[1]);
    const matchIdx = Number(ctx.match[2]);

    const film = state.films[filmIdx];
    const match = film.potentialMatches?.[matchIdx];
    if (!match) {
      await ctx.answerCbQuery('Неверный выбор.');
      return;
    }

    // Apply chosen match to FilmData
    film.title = match.title;
    // Overwrite year only if the match contains a concrete value – this avoids accidentally wiping
    // out an existing year when TMDB entry lacks a release date
    if (match.year != null) {
      film.year = match.year;
    }
    if (match.tmdbId != null) {
      film.tmdbId = match.tmdbId;
    }

    // Advance state and prompt next film (if any)
    state.currentIdx += 1;
    session.selection = state;
    await saveState(userId, session);
    await ctx.answerCbQuery('✅ Выбранный вариант сохранён');

    // Remove the message with matches list before sending the next one to keep chat clean
    try {
      await ctx.deleteMessage();
      console.log(`[manualSelectionHandler] Deleted matches list message for user ${userId}`);
    } catch {
      /* Message might have been deleted already or deletion not permitted */
    }

    await promptNextFilm(ctx);
  });

  bot.action(/^single_yes_(\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const session = await loadState(userId);
    const state = session.selection;
    if (!state) {
      await ctx.answerCbQuery('Нет активного выбора.');
      return;
    }

    const filmIdx = Number(ctx.match[1]);
    const film = state.films[filmIdx];
    const match = film.potentialMatches?.[0];
    if (!match) {
      await ctx.answerCbQuery('Неверный выбор.');
      return;
    }

    // Apply chosen match to FilmData (same as multiple-choice branch)
    film.title = match.title;
    if (match.year != null) {
      film.year = match.year;
    }
    if (match.tmdbId != null) {
      film.tmdbId = match.tmdbId;
    }

    // Advance state and persist
    state.currentIdx += 1;
    session.selection = state;
    await saveState(userId, session);
    await ctx.answerCbQuery('✅ Выбранный вариант сохранён');

    // Remove the message before prompting next
    try {
      await ctx.deleteMessage();
    } catch {/* ignore */}

    await promptNextFilm(ctx);
  });

  bot.action(/^single_no_(\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const session = await loadState(userId);
    const state = session.selection;
    if (!state) {
      await ctx.answerCbQuery('Нет активного выбора.');
      return;
    }

    // Simply skip enrichment for this film
    state.currentIdx += 1;
    session.selection = state;
    await saveState(userId, session);
    await ctx.answerCbQuery('⏭️ Пропущено');

    // Remove the message and go to next film
    try {
      await ctx.deleteMessage();
    } catch {/* ignore */}

    await promptNextFilm(ctx);
  });

  // ------- Skip button handler for MULTI-selection -----------------------
  bot.action(/^multi_skip_(\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const session = await loadState(userId);
    const state = session.selection;
    if (!state) {
      await ctx.answerCbQuery('Нет активного выбора.');
      return;
    }

    // Simply skip enrichment for this film (same logic as single_no)
    state.currentIdx += 1;
    session.selection = state;
    await saveState(userId, session);
    await ctx.answerCbQuery('⏭️ Пропущено');

    // Remove the message with matches before moving on
    try {
      await ctx.deleteMessage();
    } catch {
      /* ignore if deletion fails */
    }

    await promptNextFilm(ctx);
  });

  // ------- Skip ALL remaining films (initial prompt) ---------------------
  bot.action('skip_all', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const session = await loadState(userId);
    const state = session.selection;
    if (!state) {
      await ctx.answerCbQuery('Нет активного выбора.');
      return;
    }

    // Acknowledge button press and provide immediate feedback
    await ctx.answerCbQuery('⏭️ Все оставшиеся фильмы пропущены');

    // Remove the message that contained the original "skip all / manual" prompt
    try {
      await ctx.deleteMessage();
    } catch { /* ignore if already removed */ }

    // Mark all remaining selections as processed by moving cursor to the end
    state.currentIdx = state.selectionQueue.length;
    session.selection = state;
    await saveState(userId, session);

    // Proceed straight to the final phase (stats report generation)
    await promptNextFilm(ctx);
  });

  // ------- Start manual selection from the initial prompt --------------
  bot.action('manual_start', async (ctx) => {
    await ctx.answerCbQuery();

    // Remove initial prompt to keep chat tidy
    try {
      await ctx.deleteMessage();
    } catch { /* ignore */ }

    await promptNextFilm(ctx);
  });

  // ------- Cancel skipping all ------------------------------------------
  bot.action('skip_all_cancel', async (ctx) => {
    await ctx.answerCbQuery('Продолжаем выбор фильмов');
    try {
      await ctx.deleteMessage(); // Remove the confirmation message
    } catch {/* ignore */}
    await promptNextFilm(ctx);
  });

  // ------- Confirm skipping all -----------------------------------------
  bot.action('skip_all_confirm', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const session = await loadState(userId);
    const state = session.selection;
    if (!state) {
      await ctx.answerCbQuery('Нет активного выбора.');
      return;
    }

    // Mark all remaining selections as processed by moving cursor to the end
    state.currentIdx = state.selectionQueue.length;
    session.selection = state;
    await saveState(userId, session);

    await ctx.answerCbQuery('⏭️ Все оставшиеся фильмы пропущены');
    try {
      await ctx.deleteMessage(); // Remove confirmation prompt
    } catch {/* ignore */}

    await promptNextFilm(ctx);
  });
} 