import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { KinopoiskProfileClient, parseKinopoiskProfile, ProfileRequest } from '../services/kinopoiskProfileService';

const item = (id: number, extra: any = {}) => ({
  movie: { id, __typename: 'Film', title: { original: `Film ${id}`, localized: 'Фильм' }, productionYear: 2020, ...extra },
  reactions: [{ __typename: 'Vote', value: 8, votedAt: '2020-01-02T20:30:00Z' },
    { __typename: 'Watched', watched: true, updatedAt: '2021-02-03T04:00:00Z' }],
});
const page = (items: any[], total = items.length, offset = 0) => ({ status: 200,
  data: { data: { userProfileBySocialAlias: { userData: { movieReactions: { items, total, offset, limit: 20 } } } } } });
const error = (message: string) => ({ status: 200, data: { errors: [{ message }] } });
const setup = () => {
  const request = jest.fn<Promise<any>, [ProfileRequest, number]>();
  const sleep = jest.fn(async (_: number) => undefined);
  return { request, sleep, client: new KinopoiskProfileClient({ request, sleep }) };
};

describe('profile input', () => {
  test.each([
    ['2425315', '2425315'], [' 2425315 \n', '2425315'], ['@unique-alias', 'unique-alias'],
    ['unique.alias', 'unique.alias'], ['https://www.kinopoisk.ru/user/2425315/', '2425315'],
    ['https://kinopoisk.ru/user/alias/movies/voted-watched/?page=2#top', 'alias'],
    ['http://kinopoisk.ru/user/1', '1'], ['kinopoisk.ru/user/1/votes/', '1'],
    ['www.kinopoisk.ru/user/alias/', 'alias'], ['https://WWW.KINOPOISK.RU/user/1/', '1'],
    ['https://kinopoisk.ru/user/%61lias/', 'alias'],
  ])('normalizes %s', (input, expected) => expect(parseKinopoiskProfile(input)).toBe(expected));
  test.each(['', ' ', 'John Smith', '@', '../1', 'https://evil.test/user/1/',
    'https://kinopoisk.ru.evil.test/user/1/', 'https://kinopoisk.ru@evil.test/user/1/',
    'https://evil.test@kinopoisk.ru/user/1/', 'https://kinopoisk.ru:123/user/1/',
    'https://kinopoisk.ru/film/1/', 'https://kinopoisk.ru/user/', 'https://kinopoisk.ru/user/%2F/',
    'https://kinopoisk.ru/user/%ZZ/', 'file:///etc/passwd', 'http://127.0.0.1/user/1',
    'https://kinopoisk.ru/user/1/ other text', '<script>', 'a'.repeat(101)])('rejects %s', input => {
    expect(() => parseKinopoiskProfile(input)).toThrow();
  });
});

describe('anonymous structured import', () => {
  const planned = (id: number) => ({ ...item(id), reactions: [{ __typename: 'PlannedToWatch', plannedToWatch: true }] });
  it('fetches all watchlist pages using the website document and preserves order without watched status', async () => {
    const { client, request } = setup();
    request.mockResolvedValueOnce(page(Array.from({ length: 20 }, (_, i) => planned(i + 1)), 21))
      .mockResolvedValueOnce(page([planned(21)], 21, 20));
    const result = await client.importWatchlist('https://kinopoisk.ru/user/1/movies/planned-to-watch/');
    expect(result).toMatchObject({ total: 21, pages: 2, source: 'website', warnings: [] });
    expect(result.films.map(f => f.kinopoiskId)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
    expect(result.films.every(f => f.rating === null && f.watchDate === null && f.watchedMarkedAt === null && f.ratedAt === null)).toBe(true);
    expect(request.mock.calls.map(([b]) => b.variables.offset)).toEqual([0, 20]);
    for (const [body] of request.mock.calls) {
      expect(body.operationName).toBe('UserReactionMoviesPage');
      expect(body.variables).toMatchObject({ includeTypes: ['PLANNED_TO_WATCH'], isAuthorized: false, socialAlias: '1' });
    }
  });
  it('accepts an empty watchlist independently of history', async () => {
    const { client, request } = setup(); request.mockResolvedValue(page([]));
    expect(await client.importWatchlist('1')).toMatchObject({ total: 0, films: [], source: 'website' });
  });
  it.each([
    ['unwatched flag', { ...planned(1), reactions: [{ __typename: 'PlannedToWatch', plannedToWatch: false }] }, 'watchlist'],
    ['watched record in watchlist', item(1), 'watchlist'],
    ['watchlist record in history', planned(1), 'history'],
  ])('rejects %s instead of conflating memberships', async (_, record, kind) => {
    const { client, request } = setup(); request.mockResolvedValue(page([record]));
    await expect(kind === 'watchlist' ? client.importWatchlist('1') : client.importProfile('1')).rejects.toMatchObject({ code: 'SCHEMA_CHANGED' });
  });
  it.each([
    ['partial page', page([planned(1)], 25), 'INCOMPLETE_IMPORT'],
    ['duplicate entries', page([planned(1), planned(1)]), 'INCOMPLETE_IMPORT'],
    ['unavailable', error('User authentication failed: anonymous user'), 'PROFILE_UNAVAILABLE'],
    ['data with errors', { status: 200, data: { ...page([planned(1)]).data, errors: [{ message: 'subgraph failure' }] } }, 'SCHEMA_CHANGED'],
  ])('rejects a watchlist with %s without returning partial records', async (_, response, code) => {
    const { client, request } = setup(); request.mockResolvedValue(response);
    await expect(client.importWatchlist('1')).rejects.toMatchObject({ code });
  });
  it('reads a real Android response and keeps event timestamps out of diary dates', async () => {
    const { client, request } = setup();
    request.mockResolvedValue({ status: 200, data: JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/profile-response.json'), 'utf8')) });
    const result = await client.importProfile('2425315');
    expect(result.total).toBe(2); expect(result.films[0]).toMatchObject({
      kinopoiskId: 469619, title: 'Spartacus', type: 'series', year: 2010, rating: 8, watchDate: null,
      ratedAt: '2014-05-18T19:45:35Z', watchedMarkedAt: '2024-03-01T07:52:56.999760Z',
    });
    expect(request.mock.calls[0][0].operationName).toBe('FoldersMobileRatedOrWatchedMoviesBySocialAlias');
    expect(request.mock.calls[0][0].variables.socialAlias).toEqual({ socialAlias: '2425315' });
  });
  it('requests only the fixed Kinopoisk endpoint, without credentials', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ status: 200, data: page([item(1)]).data, headers: {} });
    try {
      await new KinopoiskProfileClient().importProfile('https://kinopoisk.ru/user/1/');
      const [url, , options] = post.mock.calls[0];
      expect(url).toBe('https://graphql.kinopoisk.ru/graphql/');
      expect(options).toMatchObject({ maxRedirects: 0 });
      expect(options?.headers).not.toHaveProperty('Cookie');
      expect(options?.headers).not.toHaveProperty('Authorization');
      expect(options?.headers).not.toHaveProperty('X-API-KEY');
    } finally { post.mockRestore(); }
  });
  it('imports every page, including a short final page', async () => {
    const { client, request } = setup(); const progress = jest.fn();
    request.mockResolvedValueOnce(page(Array.from({ length: 20 }, (_, i) => item(i + 1)), 41))
      .mockResolvedValueOnce(page(Array.from({ length: 20 }, (_, i) => item(i + 21)), 41, 20))
      .mockResolvedValueOnce(page([item(41)], 41, 40));
    const result = await client.importProfile('1', { onProgress: progress });
    expect(result).toMatchObject({ total: 41, collected: 41, pages: 3, source: 'android' });
    expect(new Set(result.films.map(f => f.kinopoiskId)).size).toBe(41);
    expect(request.mock.calls.map(([b]) => b.variables.moviesOffset)).toEqual([0, 20, 40]);
    expect(progress.mock.calls[progress.mock.calls.length - 1]?.[0]).toEqual({ total: 41, collected: 41, pages: 3 });
  });
  it('does not impose the third-party 1500-entry history cap', async () => {
    const { client, request } = setup();
    request.mockImplementation(async b => {
      const offset = b.variables.moviesOffset as number;
      return page(Array.from({ length: Math.min(20, 1601 - offset) }, (_, i) => item(offset + i + 1)), 1601, offset);
    });
    const result = await client.importProfile('1');
    expect(result.films).toHaveLength(1601); expect(result.pages).toBe(81);
    expect(result.films[result.films.length - 1]?.kinopoiskId).toBe(1601);
  });
  it('accepts an empty accessible profile', async () => {
    const { client, request } = setup(); request.mockResolvedValue(page([]));
    expect(await client.importProfile('1')).toMatchObject({ total: 0, films: [], pages: 1 });
  });
  it('preserves watched-without-rating and localized titles', async () => {
    const { client, request } = setup(); const record = item(1, { title: { localized: 'Фильм' }, productionYear: undefined, fallbackYear: 1999 });
    record.reactions = [{ __typename: 'Watched', watched: true, updatedAt: '2021-02-03T04:00:00Z' }] as any;
    request.mockResolvedValue(page([record]));
    expect((await client.importProfile('1')).films[0]).toMatchObject({ title: 'Фильм', year: 1999, rating: null, watchDate: null, ratedAt: null });
  });
  test.each([['Video', 'film'], ['MiniSeries', 'series'], ['TvShow', 'series'], ['TvSeries', 'series']])('maps %s', async (kind, type) => {
    const { client, request } = setup(); request.mockResolvedValue(page([item(1, { __typename: kind })]));
    expect((await client.importProfile('1')).films[0].type).toBe(type);
  });
  it('falls back to the exact website document only when the Android operation is rejected', async () => {
    const { client, request } = setup(); request.mockResolvedValueOnce(error('the query is not allowed')).mockResolvedValueOnce(page([item(1)]));
    const result = await client.importProfile('1');
    expect(result.source).toBe('website'); expect(result.warnings).toHaveLength(1);
    expect(request.mock.calls[1][0].operationName).toBe('UserReactionMoviesPage');
  });
  test.each([
    ['missing profile', { status: 200, data: { data: { userProfileBySocialAlias: null } } }, 'PROFILE_UNAVAILABLE'],
    ['private profile', error('User authentication failed: anonymous user'), 'PROFILE_UNAVAILABLE'],
    ['HTTP forbidden', { status: 403, data: {} }, 'PROFILE_UNAVAILABLE'],
    ['HTML challenge', { status: 200, data: '<html>challenge</html>' }, 'SCHEMA_CHANGED'],
    ['missing root', { status: 200, data: { data: {} } }, 'SCHEMA_CHANGED'],
    ['bad status', { status: 400, data: {} }, 'UPSTREAM_ERROR'],
    ['partial data with errors', { status: 200, data: { ...page([item(1)]).data, errors: [{ message: 'subgraph failure' }] } }, 'SCHEMA_CHANGED'],
    ['short non-final page', page([item(1)], 30), 'INCOMPLETE_IMPORT'],
    ['too many entries', page([item(1)], 0), 'INCOMPLETE_IMPORT'],
    ['duplicate on page', page([item(1), item(1)]), 'INCOMPLETE_IMPORT'],
    ['invalid score', page([{ ...item(1), reactions: [{ __typename: 'Vote', value: 11 }] }]), 'SCHEMA_CHANGED'],
    ['missing score', page([{ ...item(1), reactions: [{ __typename: 'Vote' }] }]), 'SCHEMA_CHANGED'],
    ['invalid id', page([item(0)]), 'SCHEMA_CHANGED'],
    ['unknown title type', page([item(1, { __typename: 'Other' })]), 'SCHEMA_CHANGED'],
    ['missing title', page([item(1, { title: {} })]), 'SCHEMA_CHANGED'],
    ['invalid year', page([item(1, { productionYear: '2020' })]), 'SCHEMA_CHANGED'],
    ['missing reactions', page([{ movie: item(1).movie }]), 'SCHEMA_CHANGED'],
    ['invalid date', page([{ ...item(1), reactions: [{ __typename: 'Vote', value: 8, votedAt: 'wrong' }] }]), 'SCHEMA_CHANGED'],
    ['missing total', { status: 200, data: { data: { userProfileBySocialAlias: { userData: { movieReactions: { items: [], offset: 0, limit: 20 } } } } } }, 'SCHEMA_CHANGED'],
  ])('rejects %s without returning a partial import', async (_, response, code) => {
    const { client, request } = setup(); request.mockResolvedValue(response);
    await expect(client.importProfile('1')).rejects.toMatchObject({ code });
  });
  it('detects a changing profile total', async () => {
    const { client, request } = setup(); request.mockResolvedValueOnce(page(Array.from({ length: 20 }, (_, i) => item(i + 1)), 21))
      .mockResolvedValueOnce(page([item(21)], 22, 20));
    await expect(client.importProfile('1')).rejects.toMatchObject({ code: 'PROFILE_CHANGED' });
  });
  it('detects overlapping pages', async () => {
    const { client, request } = setup(); request.mockResolvedValueOnce(page(Array.from({ length: 20 }, (_, i) => item(i + 1)), 21))
      .mockResolvedValueOnce(page([item(1)], 21, 20));
    await expect(client.importProfile('1')).rejects.toMatchObject({ code: 'INCOMPLETE_IMPORT' });
  });
  it('retries HTTP 429 and respects Retry-After', async () => {
    const { client, request, sleep } = setup(); request.mockResolvedValueOnce({ status: 429, data: {}, retryAfter: '2' }).mockResolvedValueOnce(page([item(1)]));
    expect((await client.importProfile('1')).total).toBe(1); expect(sleep).toHaveBeenCalledWith(2000);
  });
  it('retries transient network errors', async () => {
    const { client, request } = setup(); request.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(page([item(1)]));
    expect((await client.importProfile('1')).total).toBe(1);
  });
  it('retries GraphQL rate limits carried in HTTP 200', async () => {
    const { client, request } = setup();
    request.mockResolvedValueOnce({ status: 200, data: { errors: [{ extensions: { code: 'RATE_LIMITED' } }] } })
      .mockResolvedValueOnce(page([item(1)]));
    expect((await client.importProfile('1')).total).toBe(1); expect(request).toHaveBeenCalledTimes(2);
  });
  it('retries an explicit GraphQL subgraph outage', async () => {
    const { client, request } = setup();
    request.mockResolvedValueOnce({ status: 200, data: { errors: [{ extensions: { statusCode: 503 } }] } })
      .mockResolvedValueOnce(page([item(1)]));
    expect((await client.importProfile('1')).total).toBe(1);
  });
  test.each([[429, 'RATE_LIMITED'], [503, 'UPSTREAM_ERROR']])('bounds retries for HTTP %i', async (status, code) => {
    const { client, request } = setup(); request.mockResolvedValue({ status, data: {} });
    await expect(client.importProfile('1')).rejects.toMatchObject({ code }); expect(request).toHaveBeenCalledTimes(3);
  });
  it('stops at the deadline before issuing another page request', async () => {
    const request = jest.fn(async () => page(Array.from({ length: 20 }, (_, i) => item(i + 1)), 21));
    let now = 0; const client = new KinopoiskProfileClient({ request, now: () => now, sleep: async () => { now = 20; } });
    await expect(client.importProfile('1', { maxDurationMs: 10 })).rejects.toMatchObject({ code: 'TIME_LIMIT' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid input before any request', async () => {
    const { client, request } = setup(); await expect(client.importProfile('https://evil.test')).rejects.toMatchObject({ code: 'INVALID_PROFILE' });
    expect(request).not.toHaveBeenCalled();
  });
});
