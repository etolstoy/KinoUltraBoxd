import { parseKinopoiskIdsFromHtmlFiles } from '../services/htmlParsingService';
import { FilmData } from '../models/FilmData';
import * as fs from 'fs';
import * as path from 'path';

describe('htmlParsingService', () => {
  let entries: FilmData[];

  beforeAll(() => {
    const htmlPath = path.resolve(__dirname, 'ideal.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    entries = parseKinopoiskIdsFromHtmlFiles([html]);
  });

  it('should extract 9 films from ideal.html', () => {
    console.log('entries', entries);
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBe(9);
  });

  it('should have exactly 1 series entry', () => {
    const seriesCount = entries.filter(e => e.type === 'series').length;
    expect(seriesCount).toBe(1);
  });
});

describe('htmlParsingService - MHTML support', () => {
  let entries: FilmData[];

  beforeAll(() => {
    const mhtmlPath = path.resolve(__dirname, 'ideal.mhtml');
    const mhtml = fs.readFileSync(mhtmlPath, 'utf8');
    entries = parseKinopoiskIdsFromHtmlFiles([mhtml]);
  });

  it('should extract 2 entries from ideal.mhtml', () => {
    expect(entries.length).toBe(2);
  });

  it('should correctly parse the film entry', () => {
    const film = entries.find(e => e.kinopoiskId === 126196);
    expect(film).toBeDefined();
    expect(film!.type).toBe('film');
    expect(film!.title).toBe('Das Leben der Anderen');
    expect(film!.year).toBe(2006);
    expect(film!.rating).toBe(8);
    expect(film!.watchDate).toBe('2023-01-16');
  });

  it('should correctly parse the series entry', () => {
    const series = entries.find(e => e.kinopoiskId === 404900);
    expect(series).toBeDefined();
    expect(series!.type).toBe('series');
    expect(series!.title).toBe('Breaking Bad');
    expect(series!.rating).toBe(10);
    expect(series!.watchDate).toBe('2013-11-28');
  });

  it('should return empty array for a non-Kinopoisk MHTML file', () => {
    const boundary = '----TestBoundary--';
    const plainHtml = '<html><body><p>Not a Kinopoisk page</p></body></html>';
    const fakeMhtml = [
      'From: <Saved by Blink>',
      'MIME-Version: 1.0',
      `Content-Type: multipart/related; type="text/html"; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/html',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      plainHtml,
      `--${boundary}--`,
    ].join('\n');

    const result = parseKinopoiskIdsFromHtmlFiles([fakeMhtml]);
    expect(result).toEqual([]);
  });
});

describe('htmlParsingService - Watchlist ("Буду смотреть") support', () => {
  it('should extract 200 films from Watchlist page 1', () => {
    const watchlistPath = path.resolve(__dirname, '../../test/watchlist not ready/Профиль_ Евгений С. - Фильмы.html');
    if (fs.existsSync(watchlistPath)) {
      const html = fs.readFileSync(watchlistPath, 'utf8');
      const entries = parseKinopoiskIdsFromHtmlFiles([html]);
      expect(entries.length).toBe(200);
      expect(entries[0].kinopoiskId).toBe(4854589);
      expect(entries[0].year).toBe(2023);
      expect(entries[0].rating).toBeNull();
      expect(entries[0].watchDate).toBeNull();
    }
  });

  it('should extract 48 films from Watchlist page 2', () => {
    const watchlistPath = path.resolve(__dirname, '../../test/watchlist not ready/Профиль_ Евгений С. - Фильмы 2.html');
    if (fs.existsSync(watchlistPath)) {
      const html = fs.readFileSync(watchlistPath, 'utf8');
      const entries = parseKinopoiskIdsFromHtmlFiles([html]);
      expect(entries.length).toBe(48);
      expect(entries[0].kinopoiskId).toBe(515);
      expect(entries[0].year).toBe(1995);
    }
  });
});
 