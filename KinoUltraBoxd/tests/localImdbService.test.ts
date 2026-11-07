import { FilmData } from '../models/FilmData';
import { attachImdbIds } from '../services/localImdbService';

describe('localImdbService.attachImdbIds (real database)', () => {
  const ids = [126196, 681849, 8222, 4511218, 4472502, 1354524, 421324, 7777777777, 404900];
  const films = ids.map(id => new FilmData(`Film ${id}`, null, null, null, id === 404900 ? 'series' : 'film', id));
  const processed = attachImdbIds(films);

  it('preserves every input record without mutating the original objects', () => {
    expect(processed).toHaveLength(films.length);
    expect(films.every(f => f.imdbId === null)).toBe(true);
  });

  it('resolves five known identifiers, including the exact expected IMDb title', () => {
    expect(processed.filter(f => f.imdbId !== null)).toHaveLength(5);
    expect(processed.find(f => f.kinopoiskId === 126196)?.imdbId).toBe('tt0405094');
  });

  it('keeps an unknown Kinopoisk ID unresolved', () => {
    expect(processed.find(f => f.kinopoiskId === 7777777777)?.imdbId).toBeNull();
  });
});
