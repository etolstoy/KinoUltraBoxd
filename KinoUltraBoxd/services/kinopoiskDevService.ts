import axios from 'axios';
import { FilmData } from '../models/FilmData';

/**
 * Very small wrapper around kinopoisk.dev API that resolves TMDB identifiers
 * for Kinopoisk films when both IMDb & TMDB are missing.
 *
 * The free developer API (https://api.kinopoisk.dev/documentation) requires an
 * X-API-KEY header that users can obtain from @kinopoiskdev_bot.
 */
const BASE_URL = 'https://api.kinopoisk.dev/v1.4';
const REQUEST_TIMEOUT = 15_000; // 15 s per request

interface KinopoiskResponse {
  id: number;
  type?: string;
  externalId?: {
    tmdb?: number;
    imdb?: string;
  };
}

/**
 * Fetch info for a single Kinopoisk id.  Errors are swallowed and null is
 * returned so that upstream code can proceed gracefully.
 */
async function fetchOnce(id: number, token: string): Promise<number | null> {
  const url = `${BASE_URL}/movie/${id}`;
  try {
    const { data } = await axios.get<KinopoiskResponse>(url, {
      headers: {
        'X-API-KEY': token,
        Accept: 'application/json',
      },
      timeout: REQUEST_TIMEOUT,
    });

    // Skip if not a movie
    if (!data || data.type !== 'movie') return null;

    if (data.externalId?.tmdb && typeof data.externalId.tmdb === 'number') {
      return data.externalId.tmdb;
    }
    return null;
  } catch (err) {
    // The most common problems are authentication & 404 – both are non-fatal
    // for the enrichment pipeline, so we just log and continue.
    // eslint-disable-next-line no-console
    console.warn(`[kinopoiskDevService] Request failed for kpId=${id}:`, err);
    return null;
  }
}

/**
 * Enriches FilmData with TMDB ids obtained from Kinopoisk when both IMDb &
 * TMDB are missing.  Requires the user-supplied token.
 *
 * Throws Error('KIN_TOKEN_MISSING') when token is empty so that the caller can
 * prompt the user to provide it.
 */
export async function attachTmdbIdsViaKinopoisk(
  films: FilmData[],
  token?: string,
): Promise<FilmData[]> {
  if (!token) {
    throw new Error('KIN_TOKEN_MISSING');
  }

  // Only query ids that have no imdbId & no tmdbId yet.
  const targets = films.filter((f) => f.imdbId == null && f.tmdbId == null);

  const enrichedMap = new Map<number, number>(); // kpId -> tmdbId
  for (const film of targets) {
    const mapped = await fetchOnce(film.kinopoiskId, token);
    if (mapped != null) {
      enrichedMap.set(film.kinopoiskId, mapped);
      // Small delay (100 ms) to play safe with the free plan rate-limit.
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return films.map((f) => {
    const found = enrichedMap.get(f.kinopoiskId);
    if (found != null) {
      return { ...f, tmdbId: found };
    }
    return { ...f };
  });
} 