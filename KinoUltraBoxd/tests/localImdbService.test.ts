import fs from 'fs';
import path from 'path';

import { parseKinopoiskIdsFromHtmlFiles } from '../services/htmlParsingService';
import { attachImdbIds } from '../services/localImdbService';

describe('localImdbService.attachImdbIds (real DB, parsed from ideal.html)', () => {
  const htmlPath = path.resolve(__dirname, 'ideal.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  const parsedFilms = parseKinopoiskIdsFromHtmlFiles([html]);
  const processed = attachImdbIds(parsedFilms);

  it('should parse exactly 9 entries from ideal.html', () => {
    expect(parsedFilms.length).toBe(9);
  });

  it('should attach imdbId to 5 out of 9 films', () => {
    const withImdb = processed.filter((f) => f.imdbId !== null);
    expect(withImdb.length).toBe(5);
  });

  it('should not attach imdbId to film with kinopoiskId 7777777777', () => {
    const film = processed.find((f) => f.kinopoiskId === 7777777777);
    expect(film).toBeDefined();
    expect(film!.imdbId).toBeNull();
  });
}); 