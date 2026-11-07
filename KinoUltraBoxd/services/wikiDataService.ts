import axios from 'axios';
import { FilmData } from '../models/FilmData';

/**
 * WikiData service utilities for enriching FilmData objects with TMDB identifiers.
 */

const WIKIDATA_SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'KinoUltraBoxdBot/1.0 (+https://github.com/etolstoy/KinoUltraBoxd)';
const MAX_IDS_PER_QUERY = 500;
const REQUEST_TIMEOUT = 30_000; // 30 seconds

async function fetchTmdbMappings(kinopoiskIds: number[], deadline: number): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (kinopoiskIds.length === 0) return result;

  const chunks: number[][] = [];
  for (let i = 0; i < kinopoiskIds.length; i += MAX_IDS_PER_QUERY) {
    chunks.push(kinopoiskIds.slice(i, i + MAX_IDS_PER_QUERY));
  }

  for (const chunk of chunks) {
    if (Date.now() >= deadline) break;
    try {
      const sparqlQuery = buildSparqlQuery(chunk);
      const response = await axios.post(
        WIKIDATA_SPARQL_ENDPOINT,
        `query=${encodeURIComponent(sparqlQuery)}`,
        {
          headers: {
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
          },
          timeout: Math.max(1, Math.min(REQUEST_TIMEOUT, deadline - Date.now())),
        },
      );

      const bindings = response.data?.results?.bindings ?? [];
      for (const binding of bindings) {
        const kp = binding.kpId?.value;
        const tmdb = binding.tmdbId?.value;
        if (kp && tmdb && /^\d+$/.test(kp) && /^\d+$/.test(tmdb)) {
          result.set(Number(kp), Number(tmdb));
        }
      }
    } catch (err) {
      console.warn('[wikiDataService] Failed querying WikiData');
    }
  }

  return result;
}

function buildSparqlQuery(ids: number[]): string {
  const values = ids.map((id) => `"${id}"`).join(' ');
  return `
    SELECT ?kpId ?tmdbId WHERE {
      VALUES ?kpId { ${values} }
      ?film wdt:P2603 ?kpId .
      OPTIONAL { ?film wdt:P4947 ?tmdbId . }
    }
  `.trim();
}

export async function attachTmdbIds(films: FilmData[], deadline = Date.now() + 30_000): Promise<FilmData[]> {
  const toLookup = films.filter((f) => f.tmdbId == null).map((f) => f.kinopoiskId);
  const uniqueIds = Array.from(new Set(toLookup));

  const mappings = await fetchTmdbMappings(uniqueIds, deadline);

  return films.map((film) => {
    if (film.tmdbId != null) return FilmData.clone(film);

    const mapped = mappings.get(film.kinopoiskId);
    if (mapped != null) {
      return FilmData.clone(film, { tmdbId: mapped });
    }
    return FilmData.clone(film);
  });
}
