import { Context } from 'telegraf';
import { kinopoiskProfileClient, parseKinopoiskProfile, ProfileImportError } from './services/kinopoiskProfileService';
import { enrichFilms } from './services/filmProcessingService';
import { generateLetterboxdCsv } from './services/letterboxdExportService';
import { buildStatsReport } from './services/statsReportService';
import { sessionManager } from './services/sessionManager';
import { PROFILE_VISIBILITY_HELP } from './messages';

export function profileErrorMessage(error: unknown): string {
  const code = error instanceof ProfileImportError ? error.code : 'UPSTREAM_ERROR';
  switch (code) {
    case 'INVALID_PROFILE': return 'Пришли ссылку вида https://www.kinopoisk.ru/user/2425315/ или ID / уникальный адрес профиля. Отображаемое имя пользователя может быть неуникальным.';
    case 'PROFILE_UNAVAILABLE': return 'Профиль не найден или недоступен. Проверь ссылку. Если она верна, проверь настройки доступа и пришли ссылку ещё раз.\n\n' + PROFILE_VISIBILITY_HELP;
    case 'PROFILE_CHANGED': return 'Список изменился во время загрузки. Пришли ссылку ещё раз, чтобы я собрал полный экспорт.';
    case 'INCOMPLETE_IMPORT': return 'Кинопоиск вернул неполный список. Я не отправил частичный экспорт. Пришли ссылку ещё раз чуть позже.';
    case 'TIME_LIMIT': return 'Не удалось загрузить весь профиль за отведённое время. Частичный экспорт не отправлен. Попробуй ещё раз позже.';
    case 'RATE_LIMITED': return 'Кинопоиск временно ограничил запросы. Попробуй прислать ссылку ещё раз через несколько минут.';
    case 'SCHEMA_CHANGED': return 'Ответ Кинопоиска изменился. Не удалось проверить полноту списка; экспорт не отправлен. Сообщи @etolstoy.';
    default: return 'Не получилось связаться с Кинопоиском. Попробуй прислать ссылку ещё раз позже.';
  }
}

/** One profile message completes the flow; uncertain matches are listed instead of requiring a wizard. */
export async function handleProfileImport(ctx: Context, text: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId || !ctx.chat) return;
  let alias: string;
  try { alias = parseKinopoiskProfile(text); }
  catch (error) { await ctx.reply(profileErrorMessage(error)); return; }
  const token = await sessionManager.acquireImport(userId);
  if (!token) { await ctx.reply('⏳ Твой экспорт уже выполняется. Я пришлю результат в этот чат.'); return; }
  try {
    const deadline = Date.now() + 270_000;
    const session = await sessionManager.get(userId);
    if (session.lastProfileUpdateId === ctx.update.update_id) return;
    session.lastProfileUpdateId = ctx.update.update_id;
    await sessionManager.set(userId, session);
    const status = await ctx.reply('⏳ Загружаю оценки и просмотры с Кинопоиска…');
    let lastProgress = Date.now();
    const imported = await kinopoiskProfileClient.importProfile(alias, {
      onProgress: async progress => {
        if (Date.now() - lastProgress < 10_000) return;
        lastProgress = Date.now();
        await ctx.telegram.editMessageText(ctx.chat!.id, status.message_id, undefined,
          `⏳ Загружено ${progress.collected} из ${progress.total} записей…`).catch(() => undefined);
      },
    });
    if (imported.total === 0) { await ctx.reply('В этом профиле нет доступных оценок или отметок «просмотрено».'); return; }
    await ctx.telegram.editMessageText(ctx.chat.id, status.message_id, undefined,
      `✅ Загружены все ${imported.total} записей. Подбираю идентификаторы для Letterboxd…`).catch(() => undefined);
    const films = await enrichFilms(imported.films, undefined, deadline);
    const report = buildStatsReport(films);
    if (report.stats.exportableCount > 0) {
      await ctx.replyWithDocument({ source: generateLetterboxdCsv(films), filename: 'letterboxd.csv' });
    }
    // Full backup includes unmatched titles and series; no records disappear silently.
    await ctx.replyWithDocument({ source: Buffer.from(JSON.stringify({
      alias: imported.alias, total: imported.total, source: imported.source, warnings: imported.warnings,
      entries: films,
    }, null, 2)), filename: 'kinopoisk-backup.json' });
    await ctx.reply(report.message, { parse_mode: 'Markdown' });
    if (report.notFoundFilms?.length) {
      await ctx.replyWithDocument({ source: Buffer.from(report.notFoundFilms.join('\n')), filename: 'not_found_films.txt' });
    }
    if (imported.warnings.length) await ctx.reply('Использован резервный источник Кинопоиска. Часть временных отметок может отсутствовать в резервной копии.');
    await ctx.telegram.editMessageText(ctx.chat.id, status.message_id, undefined,
      `✅ Готово: загружены все ${imported.total} записей, в CSV — ${report.stats.exportableCount} фильмов.`).catch(() => undefined);
  } catch (error) {
    console.error('[profile-import]', error instanceof ProfileImportError ? error.code : 'EXPORT_FAILED');
    await ctx.reply(profileErrorMessage(error));
  } finally {
    await sessionManager.releaseImport(userId, token);
  }
}
