import { Telegraf, Context, Markup } from 'telegraf';
import { BotSessionState } from './models/SessionModels';
import { sessionManager } from './services/SessionManager';

// Local helpers to access the persisted session state
const loadState = (userId: number) => sessionManager.get(userId);
const saveState = (userId: number, state: BotSessionState) => sessionManager.set(userId, state);

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

  // Compose message body
  const lines: string[] = [
    `Пожалуйста, выберите правильный вариант для записи с кинопоиска для фильма "${film.title}"`,
  ];
  matches.forEach((m, idx) => {
    const yearPart = m.year ? `(${m.year})` : '';
    const descrPart = m.description ? ` – ${m.description}` : '';
    lines.push(`${idx + 1}. ${m.title} ${yearPart}${descrPart}`);
  });

  // Build inline keyboard: one button per match (max 9)
  const keyboard = Markup.inlineKeyboard(
    matches.map((_, idx) => Markup.button.callback(String(idx + 1), `choose_${filmIdx}_${idx}`)),
    { columns: 3 },
  );

  await ctx.reply(lines.join('\n'), keyboard);
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

    // Remove keyboard markup from the interacted message to keep chat clean
    try {
      await ctx.editMessageReplyMarkup(undefined);
    } catch {
      /* Message might have been edited already */
    }

    await promptNextFilm(ctx);
  });
} 