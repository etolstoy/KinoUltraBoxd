import axios from 'axios';
import { FilmData } from './models/FilmData';

/**
 * WikiData service utilities for enriching FilmData objects with TMDB identifiers.
 *
 * The service queries the public WikiData SPARQL endpoint to obtain mappings
 * from Kinopoisk (property P2603) to TMDB (property P4947) identifiers.
 */

const WIKIDATA_SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'KinoUltraBoxdBot/1.0 (+https://github.com/etolstoy/KinoUltraBoxd)';
const MAX_IDS_PER_QUERY = 500; // stay well below the 2048-char URL limit even for POST bodies
const REQUEST_TIMEOUT = 30_000; // 30 seconds

/**
 * Fetches TMDB IDs for the supplied Kinopoisk IDs from WikiData.
 * @param kinopoiskIds Array of Kinopoisk identifiers
 * @returns A map kinopoiskId -> tmdbId (numeric)
 */
async function fetchTmdbMappings(kinopoiskIds: number[]): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (kinopoiskIds.length === 0) return result;

  // split to several requests in order not to overload endpoint / exceed limits
  const chunks: number[][] = [];
  for (let i = 0; i < kinopoiskIds.length; i += MAX_IDS_PER_QUERY) {
    chunks.push(kinopoiskIds.slice(i, i + MAX_IDS_PER_QUERY));
  }

  for (const chunk of chunks) {
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
          timeout: REQUEST_TIMEOUT,
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
      console.error('[wikiDataService] Failed querying WikiData:', err);
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

/**
 * Enriches the supplied FilmData array with TMDB IDs from WikiData.
 *
 * A new array with shallow-copied FilmData objects is returned – the original
 * input is never mutated.
 */
export async function attachTmdbIds(films: FilmData[]): Promise<FilmData[]> {
  // collect those that need enrichment
  const toLookup = films.filter((f) => f.tmdbId == null).map((f) => f.kinopoiskId);
  const uniqueIds = Array.from(new Set(toLookup));

  const mappings = await fetchTmdbMappings(uniqueIds);

  return films.map((film) => {
    if (film.tmdbId != null) return { ...film }; // already has tmdbId

    const mapped = mappings.get(film.kinopoiskId);
    if (mapped != null) {
      return { ...film, tmdbId: mapped };
    }
    return { ...film };
  });
} 