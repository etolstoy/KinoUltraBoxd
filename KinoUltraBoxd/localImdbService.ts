import path from 'path';
// @ts-ignore - better-sqlite3 provides its own typings but may not be picked up in some editors
import Database from 'better-sqlite3';

import { FilmData } from './models/FilmData';

/**
 * Enriches parsed films with IMDb identifiers using the local SQLite database.
 *
 * The database file `imdb.sqlite` is expected to sit in the project root next to the source files.
 * It contains table `kinopoisk_mapping` with columns:
 *   - kinopoiskId INTEGER
 *   - tmdbId TEXT  (stores IMDb id in the ttXXXXXXX format)
 *
 * Only films that already have a Kinopoisk identifier (they always should) and miss an imdbId
 * will be looked-up. The function does not mutate the original input – it returns a new array
 * with shallow-copied objects so that upstream code can rely on immutability.
 */
export function attachImdbIds(parsedFilms: FilmData[]): FilmData[] {
  // Try several likely locations for the DB so that both runtime and Jest (ts-jest temp folders) can find it.
  const candidatePaths = [
    path.resolve(__dirname, '..', 'imdb.sqlite'), // production path (compiled JS or direct TS)
    path.resolve(process.cwd(), 'KinoUltraBoxd', 'imdb.sqlite'), // when cwd is project root running ts-node
    path.resolve(process.cwd(), 'imdb.sqlite'), // fallback when tests run from project root
  ];

  const dbPath = candidatePaths.find((p) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('fs');
      return fs.existsSync(p);
    } catch {
      return false;
    }
  }) || candidatePaths[0];

  let db: InstanceType<typeof Database>;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch (err) {
    console.error('[localImdbService] Failed to open imdb.sqlite:', err);
    // Return original objects untouched in case of any error
    return parsedFilms.map((f) => ({ ...f }));
  }

  const stmt = db.prepare('SELECT tmdbId AS imdbId FROM kinopoisk_mapping WHERE kinopoiskId = ? LIMIT 1');

  const enriched = parsedFilms.map((film) => {
    if (film.imdbId) return { ...film }; // nothing to do

    try {
      const row = stmt.get(film.kinopoiskId);
      if (row && row.imdbId) {
        return { ...film, imdbId: row.imdbId };
      }
    } catch (err) {
      console.error(`[localImdbService] Lookup failed for kpId=${film.kinopoiskId}:`, err);
    }

    return { ...film }; // unchanged if not found or on error
  });

  // Close connection – it is cheap and keeps implementation simple.
  try {
    db.close();
  } catch (err) {
    console.warn('[localImdbService] Failed to close database connection:', err);
  }

  return enriched;
} 