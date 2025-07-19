import { Telegraf, Context, Markup } from 'telegraf';
import { BotSessionState } from './models/SessionModels';
import { FilmData, PotentialMatch } from './models/FilmData';
import { sessionManager } from './services/SessionManager';

// Local helpers to access the persisted session state
const loadState = (userId: number) => sessionManager.get(userId);
const saveState = (userId: number, state: BotSessionState) => sessionManager.set(userId, state);

// --- Lower-level helpers ---------------------------------------------------

async function promptSingleMatch(
  ctx: Context,
  filmIdx: number,
  film: FilmData,
  match: PotentialMatch,
): Promise<void> {
  const filmYearPart = film.year ? `(${film.year})` : '';
  const matchYearPart = match.year ? `(${match.year})` : '';
  const descrPart = match.description ? ` – ${match.description}` : '';

  const header = `Я нашел только одно подходящее совпадение с ${film.title} ${filmYearPart}:`;
  const candidateLine = `${match.title} ${matchYearPart}${descrPart}`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✅Да, это он', `single_yes_${filmIdx}`)],
    [Markup.button.callback('❌Нет, это не он', `single_no_${filmIdx}`)],
  ]);

  await ctx.reply(`${header}\n\n${candidateLine}`, keyboard);
}

async function promptMultiMatch(
  ctx: Context,
  filmIdx: number,
  film: FilmData,
  matches: PotentialMatch[],
): Promise<void> {
  const lines: string[] = [
    `Пожалуйста, выберите правильный вариант для записи с кинопоиска для фильма "${film.title}"`,
  ];
  matches.forEach((m, idx) => {
    const yearPart = m.year ? `(${m.year})` : '';
    const descrPart = m.description ? ` – ${m.description}` : '';
    lines.push(`${idx + 1}. ${m.title} ${yearPart}${descrPart}`);
  });

  const keyboard = Markup.inlineKeyboard(
    [
      // Numerical choice buttons
      ...matches.map((_, idx) =>
        Markup.button.callback(String(idx + 1), `choose_${filmIdx}_${idx}`),
      ),
      // Extra row with a "skip" button so user can ignore this film
      Markup.button.callback('❌Пропустить', `multi_skip_${filmIdx}`),
    ],
    { columns: 3 },
  );

  await ctx.reply(lines.join('\n'), keyboard);
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
    await ctx.reply('🎉 Все фильмы обработаны. Спасибо!');
    await sessionManager.clearSelection(userId);
    return;
  }

  const filmIdx = state.selectionQueue[state.currentIdx];
  const film = state.films[filmIdx];
  const matches = film.potentialMatches ?? [];

  if (matches.length === 1) {
    await promptSingleMatch(ctx, filmIdx, film, matches[0]);
    return;
  }

  await promptMultiMatch(ctx, filmIdx, film, matches);
}

/**
 * Registers the inline-button callback with the supplied Telegraf instance so
 * users can select a film during the manual disambiguation wizard.
 */
export function registerSelectionHandler(bot: Telegraf<Context>): void {
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
    film.year = match.year;
    if (match.tmdbId != null) {
      film.tmdbId = match.tmdbId;
    }

    // Advance state and prompt next film (if any)
    state.currentIdx += 1;
    session.selection = state;
    await saveState(userId, session);
    await ctx.answerCbQuery('✅ Выбран вариант сохранён');

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
    film.year = match.year;
    if (match.tmdbId != null) {
      film.tmdbId = match.tmdbId;
    }

    // Advance state and persist
    state.currentIdx += 1;
    session.selection = state;
    await saveState(userId, session);
    await ctx.answerCbQuery('✅ Выбран вариант сохранён');

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
} 