import axios from 'axios';
import { FilmData } from './models/FilmData';

/**
 * Very small wrapper around TMDB "search/movie" API – it searches a movie by
 * title and (optionally) release year, returning the *most* popular match.
 *
 * The implementation purposefully keeps the surface minimal yet robust:
 *   – It handles rate-limit or network errors gracefully, never throwing – the
 *     pipeline continues even if TMDB is temporarily unavailable.
 *   – It respects the always-applied workspace rule to keep sensitive data in
 *     the environment.  Provide your v3 access token via `TMDB_ACCESS_TOKEN`.
 */
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

function getTmdbToken(): string | undefined {
  // Evaluate at *call* time so that dotenv.config() has already populated env.
  return process.env.TMDB_API_KEY;
}

interface TmdbMovie {
  id: number;
  title: string;
  popularity: number;
  release_date?: string;
}

interface SearchResponse {
  results: TmdbMovie[];
}

async function searchOnce(title: string, year: number | null): Promise<TmdbMovie[]> {
  const token = getTmdbToken();
  if (!token) return [];

  const url = `${TMDB_BASE_URL}/search/movie`;

  try {
    const { data } = await axios.get<SearchResponse>(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      params: {
        query: title,
        ...(year != null ? { year } : {}),
      },
      timeout: 15_000,
    });

    return Array.isArray(data.results) ? data.results : [];
  } catch (err) {
    console.warn('[tmdbSearchService] TMDB request failed:', err);
    return [];
  }
}

/**
 * Returns a TMDB identifier for the supplied title/year pair, or null.
 */
async function lookupTmdbId(title: string, year: number | null): Promise<number | null> {
  // Build list of years to try: target, +1, -1.
  const yearsToTry: (number | null)[] = [];
  if (year != null) {
    yearsToTry.push(year, year + 1, year - 1);
  } else {
    yearsToTry.push(null);
  }

  const results: TmdbMovie[] = [];

  for (const y of yearsToTry) {
    const batch = await searchOnce(title, y);
    results.push(...batch);
  }

  if (results.length === 0) return null;

  // Remove duplicates by id keeping the first (highest popularity will be first later).
  const unique = new Map<number, TmdbMovie>();
  for (const movie of results) unique.set(movie.id, movie);

  const sorted = [...unique.values()].sort((a, b) => b.popularity - a.popularity);
  return sorted[0]?.id ?? null;
}

/**
 * Enriches FilmData objects with TMDB identifiers resolved via the search API.
 *
 * The function NEVER mutates its input – it always returns brand-new objects
 * to keep calling code purely functional.
 */
export async function attachTmdbIdsViaSearch(films: FilmData[]): Promise<FilmData[]> {
  // Fast-exit when token is unavailable.
  const token = getTmdbToken();
  if (!token) {
    console.warn('[tmdbSearchService] TMDB_API_KEY not provided – skipping search enrichment');
    return films.map(f => ({ ...f }));
  }

  const enrichedPromises = films.map(async (film) => {
    if (film.tmdbId != null) return { ...film }; // nothing to do

    const tmdbId = await lookupTmdbId(film.title, film.year);
    if (tmdbId != null) {
      return { ...film, tmdbId };
    }
    return { ...film };
  });

  return Promise.all(enrichedPromises);
} 