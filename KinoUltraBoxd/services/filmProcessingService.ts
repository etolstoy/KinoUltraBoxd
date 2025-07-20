// filmProcessingService.ts (moved to services folder)
import { parseKinopoiskIdsFromHtmlFiles } from './htmlParsingService';
import { FilmData } from '../models/FilmData';
import { attachImdbIds } from './localImdbService';
import { attachTmdbIds } from './wikiDataService';
import { attachTmdbIdsViaSearch } from './tmdbSearchService';
import { attachTmdbIdsViaKinopoisk } from './kinopoiskDevService';

// Helper type representing any enrichment function (sync or async)
type EnrichFn = (films: FilmData[]) => Promise<FilmData[]> | FilmData[];

// Allows custom filtering for stages (e.g. only those missing tmdbId).
type FilterFn = (film: FilmData) => boolean;

/**
 * Runs a single enrichment stage:
 *   1. Picks films that still lack BOTH imdbId and tmdbId.
 *   2. Passes them to the given enrichment function.
 *   3. Merges the returned films back into the map.
 */
async function enrichStage(
  stageName: string,
  filmMap: Map<number, FilmData>,
  enrichFn: EnrichFn,
  filterFn: FilterFn = (f) => f.imdbId == null && f.tmdbId == null && f.type === 'film',
): Promise<void> {
  const needEnrichment = [...filmMap.values()].filter(filterFn);

  console.log(`[filmProcessingService] ${stageName}: ${needEnrichment.length} film(s) need enrichment`);

  if (needEnrichment.length === 0) return;

  const enriched = await Promise.resolve(enrichFn(needEnrichment));

  // Count how many actually received a new identifier.
  const newlyEnriched = enriched.filter(
    (f) => f.imdbId != null || f.tmdbId != null,
  ).length;

  console.log(`[filmProcessingService] ${stageName}: ${newlyEnriched} film(s) enriched`);

  enriched.forEach((f) => filmMap.set(f.kinopoiskId, f));
}

/**
 * Converts Kinopoisk HTML pages to fully-enriched FilmData objects.
 *
 * Each enrichment phase (IMDb first, TMDB second) receives **only** those
 * films that still lack both identifiers. This minimises external look-ups
 * and keeps every stage focused on what it can actually enrich.
 *
 * The function does not mutate its input – it works with shallow copies and
 * returns a brand-new array.
 */
export async function process(htmlFiles: string[], kinopoiskToken?: string): Promise<FilmData[]> {
  // ---------- 1. Parse Kinopoisk pages ----------
  const parsedFilms = parseKinopoiskIdsFromHtmlFiles(htmlFiles);

  // Use a map keyed by kinopoiskId, so we can merge enriched results back in.
  const filmMap = new Map<number, FilmData>(
    parsedFilms.map((f) => [f.kinopoiskId, FilmData.clone(f)]),
  );

  // ---------- 2. IMDb enrichment ----------
   await enrichStage('IMDb enrichment', filmMap, (films) => attachImdbIds(films));

  // ---------- 3. TMDB enrichment (WikiData) ----------
  await enrichStage('TMDB enrichment (WikiData)', filmMap, attachTmdbIds);

  // ---------- 4. TMDB enrichment (Kinopoisk.dev) ----------
  await enrichStage('TMDB enrichment (Kinopoisk.dev)', filmMap, (films) => attachTmdbIdsViaKinopoisk(films, kinopoiskToken));

  // ---------- 5. TMDB enrichment (TMDB Search) ----------
  await enrichStage('TMDB enrichment (TMDB Search)', filmMap, attachTmdbIdsViaSearch);

  const finalFilms = [...filmMap.values()];
  return finalFilms;
} 