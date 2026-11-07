import axios from 'axios';
import { FilmData, PotentialMatch } from '../models/FilmData';

/**
 * Very small wrapper around TMDB "search/movie" API – it searches a movie by
 * title and (optionally) release year, returning the *most* popular match.
 *
 * Handles rate-limit errors gracefully and respects environment configuration.
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
  poster_path?: string | null;
}

interface SearchResponse {
  results: TmdbMovie[];
}

async function searchOnce(title: string, year: number | null, deadline: number): Promise<TmdbMovie[]> {
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
      timeout: Math.max(1, Math.min(15_000, deadline - Date.now())),
    });

    return Array.isArray(data.results) ? data.results : [];
  } catch (err) {
    console.warn('[tmdbSearchService] TMDB request failed');
    return [];
  }
}

/**
 * Collects up to 9 unique potential matches across ±1 year window.
 */
async function collectPotentialMatches(title: string, year: number | null, deadline: number): Promise<PotentialMatch[]> {
  const yearsToTry: (number | null)[] = [];
  if (year != null) {
    yearsToTry.push(year, year + 1, year - 1);
  } else {
    yearsToTry.push(null);
  }

  const results: TmdbMovie[] = [];

  for (const y of yearsToTry) {
    if (Date.now() >= deadline) break;
    const batch = await searchOnce(title, y, deadline);
    results.push(...batch);
  }

  if (results.length === 0) return [];

  // Deduplicate by id.
  const unique = new Map<number, TmdbMovie>();
  for (const movie of results) unique.set(movie.id, movie);

  const sorted = [...unique.values()].sort((a, b) => b.popularity - a.popularity).slice(0, 9);

  return sorted.map(
    (m) =>
      new PotentialMatch(
        m.title,
        m.release_date ? Number(m.release_date.substring(0, 4)) : null,
        m.id,
        m.popularity ?? null,
        m.overview ?? null,
        m.poster_path ?? null,
      ),
  );
}

/**
 * Enriches FilmData objects with TMDB identifiers resolved via the search API.
 * Returns brand-new objects – never mutates the input array.
 */
export async function attachTmdbIdsViaSearch(films: FilmData[], deadline = Date.now() + 60_000): Promise<FilmData[]> {
  const token = getTmdbToken();
  if (!token) {
    console.warn('[tmdbSearchService] TMDB_API_KEY not provided – skipping search enrichment');
    return films.map(f => FilmData.clone(f));
  }

  const enriched: FilmData[] = new Array(films.length);
  let cursor = 0;
  const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const worker = async () => {
    while (cursor < films.length) {
      const index = cursor++;
      const film = films[index];
      if (Date.now() >= deadline) { enriched[index] = FilmData.clone(film); continue; }
      const matches = await collectPotentialMatches(film.title, film.year, deadline);
      const exact = matches.filter(match => film.year != null && match.year === film.year
        && normalize(match.title) === normalize(film.title));
      enriched[index] = FilmData.clone(film, {
        potentialMatches: matches,
        ...(exact.length === 1 ? { tmdbId: exact[0].tmdbId } : {}),
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, films.length) }, worker));
  return enriched;
}
