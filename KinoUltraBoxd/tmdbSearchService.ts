import axios from 'axios';
import { FilmData, PotentialMatch } from './models/FilmData';

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
  overview?: string;
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
async function collectPotentialMatches(title: string, year: number | null): Promise<PotentialMatch[]> {
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

  if (results.length === 0) return [];

  // Remove duplicates by id.
  const unique = new Map<number, TmdbMovie>();
  for (const movie of results) unique.set(movie.id, movie);

  const sorted = [...unique.values()].sort((a, b) => b.popularity - a.popularity).slice(0, 9);

  return sorted.map((m): PotentialMatch => ({
    title: m.title,
    year: m.release_date ? Number(m.release_date.substring(0, 4)) : null,
    tmdbId: m.id,
    popularity: m.popularity ?? null,
    description: m.overview ?? null,
  }));
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
    const matches = await collectPotentialMatches(film.title, film.year);
    return { ...film, potentialMatches: matches };
  });

  return Promise.all(enrichedPromises);
} 