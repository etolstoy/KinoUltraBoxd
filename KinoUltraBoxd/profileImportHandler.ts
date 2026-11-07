import { Context } from 'telegraf';
import { FilmData } from './models/FilmData';
import { kinopoiskProfileClient, parseKinopoiskProfile, ProfileImportError, ProfileImport, ProfileList, ProfileProgress } from './services/kinopoiskProfileService';
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
    case 'INCOMPLETE_IMPORT': return 'Кинопоиск вернул неполный список. Частичный экспорт этого списка не отправлен. Пришли ссылку ещё раз чуть позже.';
    case 'TIME_LIMIT': return 'Не удалось загрузить весь список за отведённое время. Частичный экспорт этого списка не отправлен. Попробуй ещё раз позже.';
    case 'RATE_LIMITED': return 'Кинопоиск временно ограничил запросы. Попробуй прислать ссылку ещё раз через несколько минут.';
    case 'SCHEMA_CHANGED': return 'Ответ Кинопоиска изменился. Не удалось проверить полноту списка; его экспорт не отправлен. Сообщи @etolstoy.';
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
    const status = await ctx.reply('⏳ Загружаю оценки, просмотры и «Буду смотреть» с Кинопоиска…');
    const kinds: ProfileList[] = ['history', 'watchlist'];
    const labels = { history: 'Оценки и просмотры', watchlist: '«Буду смотреть»' };
    const progress: Partial<Record<ProfileList, ProfileProgress>> = {};
    let lastProgress = Date.now();
    const options = (kind: ProfileList) => ({
      maxDurationMs: Math.max(0, deadline - Date.now() - 30_000),
      onProgress: async (value: ProfileProgress) => {
        progress[kind] = value;
        if (Date.now() - lastProgress < 10_000) return;
        lastProgress = Date.now();
        await ctx.telegram.editMessageText(ctx.chat!.id, status.message_id, undefined,
          kinds.map(k => progress[k]
            ? `⏳ ${labels[k]}: ${progress[k]!.collected} из ${progress[k]!.total}`
            : `⏳ ${labels[k]}: загружаю…`).join('\n')).catch(() => undefined);
      },
    });
    // Each list has strict pagination and its own outcome. A failed list never becomes an empty one.
    const results = await Promise.allSettled([
      kinopoiskProfileClient.importProfile(alias, options('history')),
      kinopoiskProfileClient.importWatchlist(alias, options('watchlist')),
    ]);
    const imported: Partial<Record<ProfileList, ProfileImport>> = {};
    const failures: Partial<Record<ProfileList, unknown>> = {};
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') imported[kinds[i]] = result.value;
      else failures[kinds[i]] = result.reason;
    });
    const failedKinds = kinds.filter(k => !imported[k]);
    const finishStatus = (message: string) => ctx.telegram.editMessageText(ctx.chat!.id, status.message_id,
      undefined, message).catch(() => undefined);
    if (failedKinds.length === kinds.length) {
      const reasons = [...new Set(failedKinds.map(k => profileErrorMessage(failures[k])))];
      await ctx.reply(`❌ Не удалось загрузить оценки, просмотры и «Буду смотреть».\n\n${reasons.join('\n\n')}`);
      await finishStatus('❌ Не удалось загрузить списки. Пришли ссылку ещё раз позже.');
      return;
    }
    for (const kind of failedKinds) {
      await ctx.reply(`❌ ${labels[kind]}: список не загружен.\n\n${profileErrorMessage(failures[kind])}`);
    }
    if (!failedKinds.length && kinds.every(k => imported[k]!.total === 0)) {
      await ctx.reply('В этом профиле нет доступных оценок, отметок «просмотрено» или записей в «Буду смотреть».');
      await finishStatus('✅ Проверены оба списка: они пусты.');
      return;
    }
    await finishStatus('⏳ Загрузка завершена. Подбираю идентификаторы для Letterboxd…');
    // Resolve each movie once, then copy only metadata back into the original memberships.
    // Copying whole enriched records would leak ratings/watched markers into the watchlist.
    const unique = new Map<number, FilmData>();
    for (const kind of kinds) for (const film of imported[kind]?.films ?? []) unique.set(film.kinopoiskId, film);
    const enriched = await enrichFilms([...unique.values()], undefined, deadline - 10_000);
    const metadata = new Map(enriched.map(f => [f.kinopoiskId, f]));
    const backup: Record<string, unknown> = { schemaVersion: 2, alias };
    const summaries: string[] = [];
    const omitted: string[] = [];
    const captions = {
      history: 'Оценки и просмотренные фильмы.\n\nСначала загрузи этот файл на https://letterboxd.com/import/ — фильмы будут отмечены просмотренными.',
      watchlist: 'Фильмы из «Буду смотреть».\n\nПосле импорта просмотров открой https://letterboxd.com/watchlist/ → Import films to watchlist. Загрузи этот файл, проверь совпадения и нажми Add films to watchlist.\n\nДля этого файла используй именно импорт в watchlist.',
    };
    for (const kind of kinds) {
      const list = imported[kind];
      if (!list) {
        const error = failures[kind];
        backup[kind] = { status: 'failed', error: error instanceof ProfileImportError ? error.code : 'UPSTREAM_ERROR', total: null, entries: null };
        continue;
      }
      const films = list.films.map(f => {
        const match = metadata.get(f.kinopoiskId);
        return match ? FilmData.clone(f, { imdbId: match.imdbId, tmdbId: match.tmdbId, potentialMatches: match.potentialMatches }) : f;
      });
      const report = buildStatsReport(films, kind);
      if (report.stats.exportableCount > 0) {
        await ctx.replyWithDocument({ source: generateLetterboxdCsv(films, kind), filename: `letterboxd-${kind === 'history' ? 'watched' : 'watchlist'}.csv` },
          { caption: captions[kind] });
      }
      backup[kind] = { status: list.total === 0 ? 'empty' : 'ok', total: list.total, source: list.source, warnings: list.warnings, entries: films };
      summaries.push(report.message);
      if (report.notFoundFilms?.length) omitted.push(`# ${labels[kind]}`, ...report.notFoundFilms, '');
      if (list.warnings.length) summaries.push('Для оценок и просмотров использован резервный источник. Часть временных отметок может отсутствовать в резервной копии.');
    }
    await ctx.replyWithDocument({ source: Buffer.from(JSON.stringify(backup, null, 2)), filename: 'kinopoisk-backup.json' });
    await ctx.reply(summaries.join('\n\n'));
    if (omitted.length) {
      await ctx.replyWithDocument({ source: Buffer.from(omitted.join('\n')), filename: 'not_found_films.txt' });
    }
    await finishStatus(failedKinds.length
      ? '⚠️ Готово для доступного списка. Второй список не загружен; подробности выше.'
      : '✅ Готово! Файлы и инструкции — выше.');
  } catch (error) {
    console.error('[profile-import]', error instanceof ProfileImportError ? error.code : 'EXPORT_FAILED');
    await ctx.reply(profileErrorMessage(error));
  } finally {
    await sessionManager.releaseImport(userId, token);
  }
}
