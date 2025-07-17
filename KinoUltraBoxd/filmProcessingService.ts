import { parseKinopoiskIdsFromHtmlFiles } from './htmlParsingService';
import { FilmData } from './models/FilmData';

/**
 * Stub function to process a list of HTML file contents into film data models.
 * @param htmlFiles Array of HTML file contents as strings
 * @returns Array of FilmData (currently always empty)
 */
export function process(htmlFiles: string[]): FilmData[] {
  console.log('process');
  const parsedFilms = parseKinopoiskIdsFromHtmlFiles(htmlFiles);
  console.log('Extracted entries:', parsedFilms);
  // TODO: Implement actual processing logic
  return [];
} 