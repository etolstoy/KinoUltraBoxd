/** Opt-in live acceptance checks. Public reads only; Telegram deliveries are intercepted locally. */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import assert from 'assert/strict';
import axios from 'axios';
import { Telegram } from 'telegraf';
import { KinopoiskProfileClient, ProfileImportError } from '../services/kinopoiskProfileService';
import { WEBSITE_QUERY, MOBILE_QUERY } from '../services/kinopoiskQueries';
import { enrichFilms } from '../services/filmProcessingService';
import { generateLetterboxdCsv } from '../services/letterboxdExportService';
import { buildStatsReport } from '../services/statsReportService';
import { bot } from '../bot';

const digest = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const headers = { 'Content-Type': 'application/json', 'service-id': '25', 'source-id': '1',
  Origin: 'https://www.kinopoisk.ru', Referer: 'https://www.kinopoisk.ru/' };
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

async function websiteReference(alias: string) {
  const entries = new Map<number, number | null>();
  let expected: number | undefined;
  for (let offset = 0; ; offset += 20) {
    const response = await axios.post('https://graphql.kinopoisk.ru/graphql/', {
      operationName: 'UserReactionMoviesPage', query: WEBSITE_QUERY,
      variables: { isAuthorized: false, socialAlias: alias, includeTypes: ['WATCHED', 'VOTE'], limit: 20, offset,
        orderBy: 'UPDATED_AT_DESC', supportedFilterTypes: ['BOOLEAN', 'SINGLE_SELECT'],
        filters: { booleanFilterValues: [], intRangeFilterValues: [], multiSelectFilterValues: [], realRangeFilterValues: [], singleSelectFilterValues: [] },
        singleSelectFiltersLimit: 700, singleSelectFiltersOffset: 0 },
    }, { headers, timeout: 15000, maxRedirects: 0 });
    assert(!response.data.errors?.length, 'Reference query returned errors');
    const list = response.data.data.userProfileBySocialAlias.userData.movieReactions;
    if (expected === undefined) expected = list.total;
    assert.equal(list.total, expected, 'Reference profile changed during comparison');
    for (const row of list.items) {
      assert(!entries.has(row.movie.id), 'Reference query duplicated an entry');
      entries.set(row.movie.id, row.reactions.find((r: any) => r.__typename === 'Vote')?.value ?? null);
    }
    if (entries.size === expected) return entries;
    assert(list.items.length === 20, 'Incomplete reference page');
    await sleep(250);
  }
}

async function verifyTelegramFlow(directory: string, alias = '1') {
  const original = Telegram.prototype.callApi;
  const documents: { filename: string; bytes: number; sha256: string }[] = [];
  let messages = 0;
  const transcript: { method: string; text: string }[] = [];
  // The production Telegraf middleware runs unchanged. Its outgoing API transport is replaced.
  Telegram.prototype.callApi = (async (method: string, payload: any) => {
    if (method === 'sendDocument') {
      assert(Buffer.isBuffer(payload.document.source));
      const { filename, source } = payload.document;
      fs.writeFileSync(path.join(directory, `telegram-${filename}`), source);
      documents.push({ filename, bytes: source.length, sha256: digest(source) });
    }
    if (payload.text || payload.caption) transcript.push({ method, text: payload.text || payload.caption });
    messages++;
    return { message_id: messages, date: 0, chat: { id: -424242, type: 'private' } };
  }) as any;
  bot.botInfo = { id: 42, is_bot: true, first_name: 'Local acceptance test', username: 'local_verification_bot' } as any;
  try {
    await bot.handleUpdate({ update_id: Date.now(), message: { message_id: 1, date: 0,
      from: { id: -424242, is_bot: false, first_name: 'Local' },
      chat: { id: -424242, type: 'private', first_name: 'Local' },
      text: `https://www.kinopoisk.ru/user/${alias}/` } });
    fs.writeFileSync(path.join(directory, 'telegram-transcript.json'), JSON.stringify(transcript, null, 2));
    if (!documents.length) {
      const empty = transcript.some(m => m.text === '✅ Проверены оба списка: они пусты.');
      const unavailable = alias === '999999999999999' && transcript.some(m => m.text.startsWith('❌ Не удалось загрузить списки.'));
      assert(empty || unavailable, 'No documents were produced without an expected empty/unavailable outcome');
      return { input: alias, telegramNetworkRequests: 0, documents, outcome: empty ? 'both empty' : 'profile unavailable' };
    }
    const backup = JSON.parse(fs.readFileSync(path.join(directory, 'telegram-kinopoisk-backup.json'), 'utf8'));
    assert.equal(backup.schemaVersion, 2);
    const counts: Record<string, unknown> = {};
    for (const kind of ['history', 'watchlist']) {
      const list = backup[kind];
      assert(['ok', 'empty'].includes(list.status), `${kind} failed during live verification`);
      assert.equal(list.total, list.entries.length);
      assert.equal(new Set(list.entries.map((f: any) => f.kinopoiskId)).size, list.total);
      const exportable = list.entries.filter((f: any) => f.type === 'film' && (f.imdbId || f.tmdbId)).length;
      const filename = `letterboxd-${kind === 'history' ? 'watched' : 'watchlist'}.csv`;
      assert.equal(documents.some(d => d.filename === filename), exportable > 0, `${kind} CSV presence disagrees with backup`);
      if (kind === 'watchlist') assert(list.entries.every((f: any) => f.rating === null && f.watchDate === null && f.watchedMarkedAt === null && f.ratedAt === null));
      counts[kind] = { total: list.total, exported: exportable, series: list.entries.filter((f: any) => f.type === 'series').length };
    }
    return { input: `https://www.kinopoisk.ru/user/${alias}/`, telegramNetworkRequests: 0,
      kinopoiskAndMapping: 'real production services', documents, lists: counts };
  } finally { Telegram.prototype.callApi = original; }
}

async function main() {
  const directory = path.resolve(process.env.PROFILE_EVIDENCE_DIR || 'artifacts/profile-import');
  fs.mkdirSync(directory, { recursive: true });
  const inputs = process.argv.slice(2);
  const botOnly = inputs[0] === '--bot-only';
  const aliases = botOnly ? [] : inputs.length ? inputs : ['1', '12345', '20000', '2425315', '999999999999999'];
  const report: any = { startedAt: new Date().toISOString(), node: process.version,
    authentication: { cookie: false, authorization: false, apiKey: false },
    querySha256: digest(MOBILE_QUERY), cases: [] };
  for (const input of aliases) {
    const started = Date.now();
    try {
      const imported = await new KinopoiskProfileClient().importProfile(input);
      const reference = await websiteReference(imported.alias);
      assert.equal(imported.total, reference.size);
      for (const film of imported.films) {
        assert(reference.has(film.kinopoiskId), 'Android and website IDs differ');
        assert.equal(film.rating, reference.get(film.kinopoiskId), 'Android and website personal ratings differ');
        assert.equal(film.watchDate, null, 'Source timestamps became a diary date');
      }
      const enriched = await enrichFilms(imported.films);
      assert.equal(enriched.length, imported.total, 'Enrichment lost entries');
      const csv = generateLetterboxdCsv(enriched);
      const stats = buildStatsReport(enriched).stats;
      fs.writeFileSync(path.join(directory, `${imported.alias}.csv`), csv);
      const result = { input, status: 'PASS', total: imported.total, pages: imported.pages,
        rated: imported.films.filter(f => f.rating !== null).length,
        unratedWatched: imported.films.filter(f => f.rating === null).length,
        ratedWithTimestamp: imported.films.filter(f => f.ratedAt !== null).length,
        series: stats.seriesCount, exported: stats.exportableCount, unmatchedFilms: stats.unmatchedFilmCount,
        independentWebsiteComparison: 'every ID and personal rating agrees', source: imported.source,
        csvSha256: digest(csv), idsSha256: digest(imported.films.map(f => f.kinopoiskId).sort((a, b) => a - b).join(',')),
        elapsedMs: Date.now() - started };
      report.cases.push(result); console.log(JSON.stringify(result));
    } catch (error) {
      if (error instanceof ProfileImportError && error.code === 'PROFILE_UNAVAILABLE' && input === '999999999999999') {
        const result = { input, status: 'PASS', expectedError: error.code, elapsedMs: Date.now() - started };
        report.cases.push(result); console.log(JSON.stringify(result));
      } else { throw error; }
    }
    fs.writeFileSync(path.join(directory, 'live-results.json'), JSON.stringify(report, null, 2));
  }
  report.telegram = await verifyTelegramFlow(directory, botOnly ? inputs[1] || '1' : '1');
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(directory, 'live-results.json'), JSON.stringify(report, null, 2));
  console.log(`PASS: evidence saved to ${directory}`);
}

if (require.main === module) main().catch(error => {
  console.error(error instanceof ProfileImportError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : 'Verification failed');
  process.exitCode = 1;
});
