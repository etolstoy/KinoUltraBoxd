import { FilmData } from '../models/FilmData';

/**
 * Generates a CSV (RFC-4180 compliant) buffer that can be imported to Letterboxd.
 *
 * Rules:
 *   • Only films that have either tmdbId **or** imdbId are exported (others are skipped).
 *   • Output columns must match Letterboxd spec exactly and be in the following order:
 *       Title,Year,Rating,WatchedDate,tmdbID,imdbID
 *   • Empty values are encoded as an empty string (two consecutive commas)
 *   • Ratings are included only when `rating > 0`.
 *
 * The function does **not** write to disk.  The caller can use the returned Buffer to
 * send the file through Telegram or save it as needed.
 */
export function generateLetterboxdCsv(films: FilmData[]): Buffer {
  // Helper: escape field for CSV, wrap in quotes if it contains dangerous chars
  const escape = (value: string): string => {
    if (value.includes('"')) {
      // Escape double quotes by doubling them per RFC-4180
      value = value.replace(/"/g, '""');
    }
    // If value contains comma, quote or newline – wrap in quotes
    if (/[",\n]/.test(value)) {
      return `"${value}"`;
    }
    return value;
  };

  // CSV header row (Letterboxd is case-sensitive for column names)
  const lines: string[] = ['Title,Year,Rating10,WatchedDate,tmdbID,imdbID'];

  films
    .filter((f) => f.tmdbId != null || f.imdbId != null)
    .forEach((movie) => {
      const cols: string[] = [];

      cols.push(escape(movie.title));
      cols.push(movie.year != null ? String(movie.year) : '');
      cols.push(movie.rating != null && movie.rating > 0 ? String(movie.rating) : '');
      cols.push(movie.watchDate ?? '');
      cols.push(movie.tmdbId != null ? String(movie.tmdbId) : '');
      cols.push(movie.imdbId != null ? String(movie.imdbId) : '');

      lines.push(cols.join(','));
    });

  const csvString = lines.join('\n');
  return Buffer.from(csvString, 'utf-8');
} 