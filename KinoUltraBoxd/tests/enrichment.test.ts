import axios from 'axios';
import { FilmData } from '../models/FilmData';
import { enrichFilms } from '../services/filmProcessingService';
import { attachTmdbIdsViaSearch } from '../services/tmdbSearchService';

afterEach(() => jest.restoreAllMocks());
it('resolves a real known Kinopoisk ID through the bundled database without asking for a key', async () => {
  const post = jest.spyOn(axios, 'post'); const get = jest.spyOn(axios, 'get');
  const result = await enrichFilms([new FilmData('Das Leben der Anderen', 2006, 8, null, 'film', 126196)], '');
  expect(result[0].imdbId).toBe('tt0405094');
  expect(post).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
});
it('preserves unresolved records when optional metadata services are unavailable', async () => {
  jest.spyOn(axios, 'post').mockRejectedValue(new Error('offline'));
  jest.spyOn(axios, 'get').mockRejectedValue(new Error('offline'));
  const film = new FilmData('Unknown', null, null, null, 'film', 7777777777);
  expect(await enrichFilms([film], '')).toHaveLength(1);
  expect(film.imdbId).toBeNull();
});
it('automatically accepts only a unique exact title and year match', async () => {
  const previous = process.env.TMDB_API_KEY; process.env.TMDB_API_KEY = 'test-only';
  const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { results: [
    { id: 7, title: 'Test Movie', release_date: '2020-01-01', popularity: 10 },
    { id: 8, title: 'Different Movie', release_date: '2020-01-01', popularity: 100 },
  ] } });
  try {
    const [film] = await attachTmdbIdsViaSearch([new FilmData('Test Movie', 2020, 8, null, 'film', 1)]);
    expect(film.tmdbId).toBe(7); expect(get).toHaveBeenCalledTimes(3);
  } finally { if (previous === undefined) delete process.env.TMDB_API_KEY; else process.env.TMDB_API_KEY = previous; }
});
it('leaves equally plausible exact matches unresolved', async () => {
  const previous = process.env.TMDB_API_KEY; process.env.TMDB_API_KEY = 'test-only';
  jest.spyOn(axios, 'get').mockResolvedValue({ data: { results: [
    { id: 7, title: 'Test', release_date: '2020-01-01', popularity: 1 },
    { id: 8, title: 'Test', release_date: '2020-01-01', popularity: 100 },
  ] } });
  try {
    const [film] = await attachTmdbIdsViaSearch([new FilmData('Test', 2020, 8, null, 'film', 1)]);
    expect(film.tmdbId).toBeNull(); expect(film.potentialMatches).toHaveLength(2);
  } finally { if (previous === undefined) delete process.env.TMDB_API_KEY; else process.env.TMDB_API_KEY = previous; }
});
it('bounds optional matching by the overall time budget and retains all records', async () => {
  const get = jest.spyOn(axios, 'get'); const post = jest.spyOn(axios, 'post');
  const films = [new FilmData('Unknown', null, null, null, 'film', 7777777777)];
  expect(await enrichFilms(films, '', Date.now() - 1)).toHaveLength(1);
  expect(get).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
});
