import { parseKinopoiskIdsFromHtmlFiles } from '../htmlParsingService';
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
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBe(9);
  });

  it('should have exactly 1 series entry', () => {
    const seriesCount = entries.filter(e => e.type === 'series').length;
    expect(seriesCount).toBe(1);
  });
}); 