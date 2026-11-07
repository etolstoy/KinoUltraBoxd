import { Telegram } from 'telegraf';
import { FilmData } from '../models/FilmData';
import { kinopoiskProfileClient, ProfileImportError } from '../services/kinopoiskProfileService';
import { enrichFilms } from '../services/filmProcessingService';
import { sessionManager } from '../services/sessionManager';

jest.mock('../services/kinopoiskProfileService', () => ({ ...jest.requireActual('../services/kinopoiskProfileService'),
  kinopoiskProfileClient: { importProfile: jest.fn(), importWatchlist: jest.fn() } }));
jest.mock('../services/filmProcessingService', () => ({ enrichFilms: jest.fn() }));
import { bot } from '../bot';

const importer = jest.mocked(kinopoiskProfileClient.importProfile);
const watchlistImporter = jest.mocked(kinopoiskProfileClient.importWatchlist);
const enrich = jest.mocked(enrichFilms);
const film = () => new FilmData('Test Film', 2020, 8, null, 'film', 126196, null, 'tt0405094', undefined, '2020-01-01T00:00:00Z');
const result = (films = [film()]) => ({ alias: '1', films, total: films.length, collected: films.length, pages: 1, source: 'android' as const, warnings: [] });
let calls: { method: string; payload: any }[];
let nextId = 90000;
const update = (text: string, id = ++nextId, userId = id) => ({ update_id: id, message: {
  message_id: id, date: 0, from: { id: userId, is_bot: false, first_name: 'Test' },
  chat: { id: userId, type: 'private' as const, first_name: 'Test' }, text,
  ...(text.startsWith('/') ? { entities: [{ type: 'bot_command' as const, offset: 0, length: text.length }] } : {}),
} });

beforeAll(() => {
  bot.botInfo = { id: 1, is_bot: true, first_name: 'Test', username: 'test_bot', can_join_groups: false,
    can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false } as any;
});
beforeEach(() => {
  calls = []; importer.mockReset(); watchlistImporter.mockReset(); enrich.mockReset();
  importer.mockResolvedValue(result()); watchlistImporter.mockResolvedValue({ ...result([]), source: 'website' }); enrich.mockImplementation(async films => films);
  jest.spyOn(Telegram.prototype, 'callApi').mockImplementation(async (method: any, payload: any) => {
    calls.push({ method, payload });
    return { message_id: calls.length, date: 0, chat: { id: payload.chat_id, type: 'private' } } as any;
  });
});
afterEach(() => jest.restoreAllMocks());

const documents = () => calls.filter(c => c.method === 'sendDocument').map(c => c.payload.document);

it.each(['1', 'https://www.kinopoisk.ru/user/1/', '@unique-alias'])('one %s message sends CSV and complete backup without follow-up input', async text => {
  await bot.handleUpdate(update(text));
  expect(importer).toHaveBeenCalledTimes(1);
  expect(documents().map(d => d.filename)).toEqual(['letterboxd-watched.csv', 'kinopoisk-backup.json']);
  expect(documents()[0].source.toString()).toContain('Test Film,2020,8,,,tt0405094');
  const backup = JSON.parse(documents()[1].source.toString());
  expect(backup.history.entries[0]).toMatchObject({ ratedAt: '2020-01-01T00:00:00Z', watchDate: null });
  expect(calls.some(c => c.payload.reply_markup?.inline_keyboard?.some((row: any[]) => row.some(b => b.callback_data === 'manual_start')))).toBe(false);
});
it('sends two CSVs with distinct destinations and keeps overlapping membership without leaking history into watchlist', async () => {
  const planned = FilmData.clone(film());
  planned.rating = null; planned.ratedAt = null; planned.watchedMarkedAt = null;
  watchlistImporter.mockResolvedValue({ ...result([planned]), source: 'website' });
  enrich.mockImplementation(async films => films.map(f => FilmData.clone(f, { tmdbId: 123 })));
  await bot.handleUpdate(update('https://kinopoisk.ru/user/1/movies/planned-to-watch/'));
  expect(documents().map(d => d.filename)).toEqual(['letterboxd-watched.csv', 'letterboxd-watchlist.csv', 'kinopoisk-backup.json']);
  expect(enrich.mock.calls[0][0]).toHaveLength(1);
  expect(documents()[0].source.toString()).toContain('Test Film,2020,8,,123,tt0405094');
  expect(documents()[1].source.toString()).toBe('Title,Year,tmdbID,imdbID\nTest Film,2020,123,tt0405094');
  const backup = JSON.parse(documents()[2].source.toString());
  expect(backup).toMatchObject({ schemaVersion: 2, history: { status: 'ok', total: 1 }, watchlist: { status: 'ok', total: 1 } });
  expect(backup.history.entries[0]).toMatchObject({ rating: 8, ratedAt: '2020-01-01T00:00:00Z' });
  expect(backup.watchlist.entries[0]).toMatchObject({ rating: null, ratedAt: null, watchedMarkedAt: null, watchDate: null, tmdbId: 123 });
  const sent = calls.filter(c => c.method === 'sendDocument');
  expect(sent[0].payload.caption).toContain('https://letterboxd.com/import/');
  expect(sent[1].payload.caption).toContain('https://letterboxd.com/watchlist/');
  expect(sent[1].payload.caption).toContain('Import films to watchlist');
});
it('exports watchlist when history is empty', async () => {
  importer.mockResolvedValue(result([])); watchlistImporter.mockResolvedValue(result([film()]));
  await bot.handleUpdate(update('1'));
  expect(documents().map(d => d.filename)).toEqual(['letterboxd-watchlist.csv', 'kinopoisk-backup.json']);
  expect(JSON.parse(documents()[1].source.toString()).history).toMatchObject({ status: 'empty', total: 0, entries: [] });
});
it.each(['history', 'watchlist'] as const)('exports the other list if %s fails and records failure instead of an empty list', async kind => {
  watchlistImporter.mockResolvedValue(result([film()]));
  (kind === 'history' ? importer : watchlistImporter).mockRejectedValue(new ProfileImportError('INCOMPLETE_IMPORT', 'incomplete'));
  await bot.handleUpdate(update('1'));
  expect(documents().map(d => d.filename)).toEqual([kind === 'history' ? 'letterboxd-watchlist.csv' : 'letterboxd-watched.csv', 'kinopoisk-backup.json']);
  const backup = JSON.parse(documents()[1].source.toString());
  expect(backup[kind]).toEqual({ status: 'failed', error: 'INCOMPLETE_IMPORT', total: null, entries: null });
  expect(calls.some(c => c.payload.text?.includes('список не загружен'))).toBe(true);
  expect(calls[calls.length - 1]?.payload.text).toContain('Второй список не загружен');
});
it('keeps unresolved watchlist entries and series in backup and in a separately labelled report', async () => {
  watchlistImporter.mockResolvedValue(result([new FilmData('Unknown planned', null, null, null, 'film', 55),
    new FilmData('Planned series', 2025, null, null, 'series', 56)]));
  await bot.handleUpdate(update('1'));
  expect(documents().map(d => d.filename)).toEqual(['letterboxd-watched.csv', 'kinopoisk-backup.json', 'not_found_films.txt']);
  const backup = JSON.parse(documents()[1].source.toString());
  expect(backup.watchlist).toMatchObject({ status: 'ok', total: 2 });
  expect(backup.watchlist.entries).toHaveLength(2);
  expect(documents()[2].source.toString()).toContain('# «Буду смотреть»');
  expect(documents()[2].source.toString()).toContain('Planned series');
});
it('exports confident matches and reports unresolved movies and series automatically', async () => {
  const unresolved = new FilmData('Unknown', 2020, 4, null, 'film', 2);
  const series = new FilmData('Series', 2020, null, null, 'series', 3);
  importer.mockResolvedValue(result([film(), unresolved, series]));
  await bot.handleUpdate(update('1'));
  expect(documents().map(d => d.filename)).toEqual(['letterboxd-watched.csv', 'kinopoisk-backup.json', 'not_found_films.txt']);
  expect(JSON.parse(documents()[1].source.toString()).history.entries).toHaveLength(3);
  expect(documents()[2].source.toString()).toContain('Unknown');
  expect(documents()[2].source.toString()).toContain('Series');
});
it('does not send a misleading empty CSV when all entries are unmatched', async () => {
  importer.mockResolvedValue(result([new FilmData('Unknown', null, null, null, 'film', 99)]));
  await bot.handleUpdate(update('1'));
  expect(documents().map(d => d.filename)).toEqual(['kinopoisk-backup.json', 'not_found_films.txt']);
});
it('handles an empty public library without enrichment or documents', async () => {
  importer.mockResolvedValue(result([])); await bot.handleUpdate(update('12345'));
  expect(enrich).not.toHaveBeenCalled(); expect(documents()).toHaveLength(0);
  expect(calls.some(c => c.payload.text?.includes('нет доступных'))).toBe(true);
});
it.each(['PROFILE_UNAVAILABLE', 'RATE_LIMITED', 'INCOMPLETE_IMPORT', 'PROFILE_CHANGED', 'SCHEMA_CHANGED', 'TIME_LIMIT'] as const)('reports %s without any partial attachments', async code => {
  importer.mockRejectedValue(new ProfileImportError(code, 'test')); watchlistImporter.mockRejectedValue(new ProfileImportError(code, 'test')); await bot.handleUpdate(update('1'));
  expect(documents()).toHaveLength(0); expect(enrich).not.toHaveBeenCalled();
});
it('shows the profile visibility instructions once when both list requests are unavailable', async () => {
  importer.mockRejectedValue(new ProfileImportError('PROFILE_UNAVAILABLE', 'private'));
  watchlistImporter.mockRejectedValue(new ProfileImportError('PROFILE_UNAVAILABLE', 'private'));
  await bot.handleUpdate(update('1'));
  expect(calls.filter(c => c.payload.text?.includes('Как проверить доступ к профилю'))).toHaveLength(1);
  expect(documents()).toHaveLength(0);
});
it('rejects an unrelated URL without contacting Kinopoisk', async () => {
  await bot.handleUpdate(update('https://example.com/user/1'));
  expect(importer).not.toHaveBeenCalled(); expect(documents()).toHaveLength(0);
});
it('deduplicates a redelivered Telegram update after the first import completes', async () => {
  const u = update('1'); await bot.handleUpdate(u); await bot.handleUpdate(u);
  expect(importer).toHaveBeenCalledTimes(1); expect(documents()).toHaveLength(2);
});
it('prevents overlapping imports for one user but releases the lock after completion', async () => {
  let resolve!: (value: ReturnType<typeof result>) => void;
  const pending = new Promise<ReturnType<typeof result>>(done => { resolve = done; });
  importer.mockReturnValueOnce(pending);
  const userId = ++nextId; const first = bot.handleUpdate(update('1', ++nextId, userId));
  while (!importer.mock.calls.length) await new Promise(done => setImmediate(done));
  await bot.handleUpdate(update('1', ++nextId, userId));
  expect(importer).toHaveBeenCalledTimes(1);
  resolve(result()); await first;
  await bot.handleUpdate(update('1', ++nextId, userId)); expect(importer).toHaveBeenCalledTimes(2);
});
it('releases a failed import lock so a new message can retry', async () => {
  const userId = ++nextId; importer.mockRejectedValueOnce(new ProfileImportError('UPSTREAM_ERROR', 'test'));
  watchlistImporter.mockRejectedValueOnce(new ProfileImportError('UPSTREAM_ERROR', 'test'));
  await bot.handleUpdate(update('1', ++nextId, userId)); await bot.handleUpdate(update('1', ++nextId, userId));
  expect(documents()).toHaveLength(2);
});
it('discards obsolete session data while preserving import deduplication', async () => {
  const userId = ++nextId;
  await sessionManager.set(userId, { fileQueue: { file_ids: ['obsolete'], file_names: [] },
    awaitingKinopoiskToken: true, kinopoiskToken: 'obsolete-test-token', lastProfileUpdateId: 42 } as any);
  expect(await sessionManager.get(userId)).toEqual({ lastProfileUpdateId: 42 });
  const u = update('1', ++nextId, userId);
  await bot.handleUpdate(u); expect(documents()).toHaveLength(2);
  expect(await sessionManager.get(userId)).toEqual({ lastProfileUpdateId: u.update_id });
});
it.each(['/start', '/help'])('%s explains profile links', async text => {
  await bot.handleUpdate(update(text)); expect(importer).not.toHaveBeenCalled();
  expect(calls.some(c => c.payload.text?.includes('https://www.kinopoisk.ru/user/'))).toBe(true);
  expect(calls.some(c => /HTML|MHTML|Начать экспорт|напиши .?go/i.test(c.payload.text ?? ''))).toBe(false);
  expect(calls.every(c => !c.payload.reply_markup)).toBe(true);
  expect(calls.some(c => c.payload.text?.includes('«Буду смотреть»'))).toBe(true);
  if (text === '/help') {
    expect(calls[0].payload.text).toContain('letterboxd-watched.csv');
    expect(calls[0].payload.text).toContain('letterboxd-watchlist.csv');
    expect(calls[0].payload.text).toContain('https://letterboxd.com/watchlist/ → Import films to watchlist');
  }
});

it('redirects document uploads to the profile flow without downloading or queuing files', async () => {
  const u = update('unused');
  const { text, ...message } = u.message;
  await bot.handleUpdate({ ...u, message: { ...message, document: {
    file_id: 'file', file_unique_id: 'unique-file', file_name: 'ratings.html', mime_type: 'text/html',
  } } });
  expect(importer).not.toHaveBeenCalled();
  expect(calls.map(c => c.method)).toEqual(['sendMessage']);
  expect(calls[0].payload.text).toContain('Пришли ссылку');
  expect(await sessionManager.get(u.message.from.id)).toEqual({});
});
it('treats go as a profile alias instead of a file-export command', async () => {
  await bot.handleUpdate(update('go'));
  expect(importer.mock.calls[0][0]).toBe('go');
  expect(documents().map(d => d.filename)).toEqual(['letterboxd-watched.csv', 'kinopoisk-backup.json']);
});
it('does not recognize /go as a command', async () => {
  await bot.handleUpdate(update('/go'));
  expect(importer).not.toHaveBeenCalled();
  expect(documents()).toHaveLength(0);
  expect(calls[0].payload.text).toContain('Пришли ссылку');
});
it.each(['export_start', 'manual_start'])('dismisses an obsolete %s button without invoking an export', async data => {
  const u = update('unused');
  await bot.handleUpdate({ update_id: u.update_id, callback_query: {
    id: 'callback', from: u.message.from, chat_instance: 'instance', data,
    message: { message_id: 1, date: 0, chat: u.message.chat, text: 'Old message' },
  } });
  expect(importer).not.toHaveBeenCalled();
  expect(calls.map(c => c.method)).toEqual(['answerCallbackQuery', 'editMessageReplyMarkup']);
  expect(calls[0].payload.text).toContain('Пришли ссылку');
});
