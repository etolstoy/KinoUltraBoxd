console.log('[test] test file loaded');
import { parseKinopoiskIdsFromHtmlFiles } from '../htmlParsingService';
import * as fs from 'fs';
import * as path from 'path';

describe('htmlParsingService', () => {
  it('should extract kinopoiskIds from ideal.html', () => {
    const htmlPath = path.resolve(__dirname, 'ideal.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    const ids = parseKinopoiskIdsFromHtmlFiles([html]);
    expect(Array.isArray(ids)).toBe(true);
    expect(ids.length).toBe(9);
    console.log('Extracted kinopoiskIds:', ids);
  });
}); 