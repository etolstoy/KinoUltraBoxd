import { FilmData } from '../models/FilmData';
import { generateLetterboxdCsv } from '../services/letterboxdExportService';
import { buildStatsReport } from '../services/statsReportService';
import { MemoryStore } from '../sessionStore';

it('keeps scores on the 1–10 scale and leaves unknown viewing dates blank', () => {
  const films = [new FilmData('Rated', 2020, 10, null, 'film', 1, null, 'tt0000001'),
    new FilmData('Watched', 2021, null, null, 'film', 2, 2)];
  expect(generateLetterboxdCsv(films).toString()).toBe('Title,Year,Rating10,WatchedDate,tmdbID,imdbID\nWatched,2021,,,2,\nRated,2020,10,,,tt0000001');
});
it('escapes commas, quotes, carriage returns, and multiline titles', () => {
  const film = new FilmData('A, "B"\r\nC', 2020, 8, null, 'film', 1, 1);
  expect(generateLetterboxdCsv([film]).toString()).toContain('"A, ""B""\r\nC",2020,8,,1,');
});
it('exports watchlist identifiers without ratings or watched dates, even for a previously watched film', () => {
  const films = [new FilmData('A, "B"', 2020, 10, '2021-01-01', 'film', 1, null, 'tt0000001'),
    new FilmData('Future', null, null, null, 'film', 2, 42),
    new FilmData('Series', 2020, null, null, 'series', 3, 43),
    new FilmData('Unknown', 2020, null, null, 'film', 4)];
  expect(generateLetterboxdCsv(films, 'watchlist').toString()).toBe('Title,Year,tmdbID,imdbID\nFuture,,42,\n"A, ""B""",2020,,tt0000001');
  expect(buildStatsReport(films, 'watchlist').message).not.toMatch(/оценк|просмотренн/i);
  expect(buildStatsReport(films, 'watchlist').stats.exportableCount).toBe(2);
});
it('CSV and report agree about series and unmatched films', () => {
  const films = [new FilmData('Movie', 2020, 8, null, 'film', 1, 1),
    new FilmData('Series', 2020, 7, null, 'series', 2, 2), new FilmData('Unknown', 2020, null, null, 'film', 3)];
  expect(generateLetterboxdCsv(films).toString().split('\n')).toHaveLength(2);
  expect(buildStatsReport(films).stats).toMatchObject({ totalEntries: 3, exportableCount: 1, skippedCount: 2, seriesCount: 1, unmatchedFilmCount: 1 });
});
it('keeps source timestamps through enrichment clones', () => {
  const film = new FilmData('Movie', 2020, 8, null, 'film', 1, null, null, undefined, '2020-01-01T00:00:00Z', '2021-01-01T00:00:00Z');
  expect(FilmData.clone(film, { imdbId: 'tt0000001' })).toMatchObject({ ratedAt: film.ratedAt, watchedMarkedAt: film.watchedMarkedAt, watchDate: null });
});
it('uses exclusive expiring locks and prevents an old owner from releasing a replacement lock', async () => {
  const store = new MemoryStore(); const now = jest.spyOn(Date, 'now').mockReturnValue(0);
  try {
    expect(await store.acquire('job', 'first', 1)).toBe(true);
    expect(await store.acquire('job', 'second', 1)).toBe(false);
    now.mockReturnValue(1001); expect(await store.acquire('job', 'second', 1)).toBe(true);
    await store.release('job', 'first'); expect(await store.acquire('job', 'third', 1)).toBe(false);
    await store.release('job', 'second'); expect(await store.acquire('job', 'third', 1)).toBe(true);
  } finally { now.mockRestore(); }
});
