import { parseKinopoiskIdsFromHtmlFiles } from './htmlParsingService';

export interface FilmData {
  title: string;
  year: number | null;
  rating: number | null;
  watchDate: string | null;
  kinopoiskId: number;
  tmdbId: number | null;
  imdbId: number | null;
}

/**
 * Stub function to process a list of HTML file contents into film data models.
 * @param htmlFiles Array of HTML file contents as strings
 * @returns Array of FilmData (currently always empty)
 */
export function process(htmlFiles: string[]): FilmData[] {
  console.log('process');
  const kinopoiskIds = parseKinopoiskIdsFromHtmlFiles(htmlFiles);
  console.log('Extracted kinopoiskIds:', kinopoiskIds);
  // TODO: Implement actual processing logic
  return [];
} 