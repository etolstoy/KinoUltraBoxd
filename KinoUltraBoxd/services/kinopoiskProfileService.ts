import axios from 'axios';
import { FilmData } from '../models/FilmData';
import { MOBILE_QUERY, WEBSITE_QUERY } from './kinopoiskQueries';

const ENDPOINT = 'https://graphql.kinopoisk.ru/graphql/';
const PAGE_SIZE = 20;

export type ProfileErrorCode = 'INVALID_PROFILE' | 'PROFILE_UNAVAILABLE' | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR' | 'SCHEMA_CHANGED' | 'INCOMPLETE_IMPORT' | 'PROFILE_CHANGED' | 'TIME_LIMIT';

export class ProfileImportError extends Error {
  constructor(public readonly code: ProfileErrorCode, message: string) { super(message); }
}

/** Only the alias is used in a fixed GraphQL request; user-supplied URLs are never fetched. */
export function parseKinopoiskProfile(input: string): string {
  let value = input.trim();
  if (/\s/.test(value)) throw new ProfileImportError('INVALID_PROFILE', 'Use a profile URL, ID, or unique alias.');
  if (/^(?:https?:\/\/|(?:www\.)?kinopoisk\.ru\/)/i.test(value)) {
    try {
      const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      if (!['kinopoisk.ru', 'www.kinopoisk.ru'].includes(url.hostname.toLowerCase())
        || url.username || url.password || url.port) throw new Error();
      const match = url.pathname.match(/^\/user\/([^/]+)(?:\/.*)?$/);
      if (!match) throw new Error();
      value = decodeURIComponent(match[1]);
    } catch { throw new ProfileImportError('INVALID_PROFILE', 'Send a Kinopoisk profile URL, ID, or unique alias.'); }
  } else {
    value = value.replace(/^@/, '');
  }
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,99}$/u.test(value)) {
    throw new ProfileImportError('INVALID_PROFILE', 'Send a Kinopoisk profile URL, ID, or unique alias.');
  }
  return value;
}

export interface ProfileProgress { collected: number; total: number; pages: number }
export interface ProfileImport extends ProfileProgress {
  alias: string;
  films: FilmData[];
  source: 'android' | 'website';
  warnings: string[];
}
interface Response { data: unknown; status: number; retryAfter?: string }
export interface ProfileRequest { operationName: string; query: string; variables: Record<string, unknown> }
interface Dependencies {
  request?: (body: ProfileRequest, timeoutMs: number) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}
interface Options {
  onProgress?: (progress: ProfileProgress) => Promise<void> | void;
  maxDurationMs?: number;
}
type Json = Record<string, any>;
function object(value: unknown): value is Json { return value !== null && typeof value === 'object' && !Array.isArray(value); }

const mobileVariables = {
  includeMovieTops: false, includeMovieRating: false, includeSeriesSeasonsCount: false,
  includeFilmDuration: false, includeMovieHorizontalCover: false, includeMovieHorizontalLogo: false,
  includeMovieRightholderForPoster: false, includeAvailabilityOptions: false, includeMovieUserVote: false,
  includeMovieUserPlannedToWatch: false, includeMovieUserFolders: false, includeMovieUserWatched: false,
  includeMovieUserNotInterested: false, includeMovieContentFeatures: false,
  includeMovieOnlyClientSupportedContentFeatures: false, includeMovieViewOption: false,
  includeMovieTop250: false, includePlannedToWatchRating: false, purchaseOptionsContext: {},
  includeMoviePurchaseOptions: false, includeTrialCutInfo: false, includeTicketOption: false,
  includeMovieReleaseDate: false,
};

function requestBody(alias: string, offset: number, source: ProfileImport['source']): ProfileRequest {
  if (source === 'android') return {
    operationName: 'FoldersMobileRatedOrWatchedMoviesBySocialAlias', query: MOBILE_QUERY,
    variables: { ...mobileVariables, socialAlias: { socialAlias: alias }, moviesLimit: PAGE_SIZE, moviesOffset: offset },
  };
  return {
    operationName: 'UserReactionMoviesPage', query: WEBSITE_QUERY,
    variables: {
      isAuthorized: false, socialAlias: alias, includeTypes: ['WATCHED', 'VOTE'], limit: PAGE_SIZE, offset,
      orderBy: 'UPDATED_AT_DESC', supportedFilterTypes: ['BOOLEAN', 'SINGLE_SELECT'],
      filters: { booleanFilterValues: [], intRangeFilterValues: [], multiSelectFilterValues: [], realRangeFilterValues: [], singleSelectFilterValues: [] },
      singleSelectFiltersLimit: 700, singleSelectFiltersOffset: 0,
    },
  };
}

function schemaError(): never { throw new ProfileImportError('SCHEMA_CHANGED', 'Kinopoisk returned an unexpected response.'); }

function timestamp(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) return schemaError();
  return value;
}

function parseFilm(item: unknown): FilmData {
  if (!object(item) || !object(item.movie) || !Array.isArray(item.reactions)) return schemaError();
  const m = item.movie;
  if (!Number.isSafeInteger(m.id) || m.id <= 0 || !object(m.title)) return schemaError();
  const title = m.title.original || m.title.localized || m.title.russian;
  if (typeof title !== 'string' || !title.trim()) return schemaError();
  if (!['Film', 'Video', 'TvSeries', 'TvShow', 'MiniSeries'].includes(m.__typename)) return schemaError();
  const year = m.productionYear ?? m.fallbackYear ?? m.releaseYears?.[0]?.start ?? null;
  if (year !== null && (!Number.isInteger(year) || year < 1800 || year > 3000)) return schemaError();
  let rating: number | null = null, ratedAt: string | null = null, watchedMarkedAt: string | null = null;
  let hasReaction = false;
  for (const reaction of item.reactions) {
    if (!object(reaction)) return schemaError();
    if (reaction.__typename === 'Vote') {
      if (!Number.isInteger(reaction.value) || reaction.value < 1 || reaction.value > 10) return schemaError();
      rating = reaction.value; ratedAt = timestamp(reaction.votedAt); hasReaction = true;
    } else if (reaction.__typename === 'Watched' && reaction.watched === true) {
      watchedMarkedAt = timestamp(reaction.updatedAt); hasReaction = true;
    } else return schemaError();
  }
  if (!hasReaction) return schemaError();
  return new FilmData(title.trim(), year, rating, null,
    ['Film', 'Video'].includes(m.__typename) ? 'film' : 'series', m.id, null, null, undefined, ratedAt, watchedMarkedAt);
}

/** Anonymous, bounded, sequential reads of official-client queries. Never returns a partial library. */
export class KinopoiskProfileClient {
  private readonly request: NonNullable<Dependencies['request']>;
  private readonly sleep: NonNullable<Dependencies['sleep']>;
  private readonly now: NonNullable<Dependencies['now']>;
  constructor(deps: Dependencies = {}) {
    this.request = deps.request ?? (async (body, timeout) => {
      const response = await axios.post(ENDPOINT, body, {
        timeout, maxRedirects: 0, validateStatus: () => true,
        headers: { 'Content-Type': 'application/json', 'service-id': '25', 'source-id': '1',
          Origin: 'https://www.kinopoisk.ru', Referer: 'https://www.kinopoisk.ru/', 'x-preferred-language': 'ru' },
      });
      return { data: response.data, status: response.status, retryAfter: response.headers['retry-after'] };
    });
    this.sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.now = deps.now ?? Date.now;
  }

  private async fetch(body: ProfileRequest, deadline: number): Promise<Response> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const remaining = deadline - this.now();
      if (remaining <= 0) throw new ProfileImportError('TIME_LIMIT', 'Import exceeded the time limit.');
      let response: Response;
      try { response = await this.request(body, Math.min(15_000, remaining)); }
      catch {
        if (attempt === 2) throw new ProfileImportError('UPSTREAM_ERROR', 'Kinopoisk could not be reached.');
        await this.sleep(1000 * 2 ** attempt); continue;
      }
      const errors = object(response.data) && Array.isArray(response.data.errors) ? response.data.errors : [];
      const graphqlRateLimit = errors.some((e: any) => e?.extensions?.statusCode === 429
        || /rate.?limit|too.?many.?requests/i.test(String(e?.extensions?.code ?? '')));
      const graphqlUnavailable = errors.some((e: any) => Number(e?.extensions?.statusCode) >= 500);
      if (response.status === 429 || response.status >= 500 || graphqlRateLimit || graphqlUnavailable) {
        if (attempt === 2) throw new ProfileImportError(response.status === 429 || graphqlRateLimit ? 'RATE_LIMITED' : 'UPSTREAM_ERROR', 'Kinopoisk is temporarily unavailable.');
        const seconds = Number(response.retryAfter);
        const dateDelay = response.retryAfter ? Date.parse(response.retryAfter) - this.now() : NaN;
        const delay = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 30_000)
          : Number.isFinite(dateDelay) && dateDelay > 0 ? Math.min(dateDelay, 30_000) : 1000 * 2 ** attempt;
        if (this.now() + delay >= deadline) throw new ProfileImportError('TIME_LIMIT', 'Import exceeded the time limit.');
        await this.sleep(delay); continue;
      }
      if (response.status === 401 || response.status === 403) throw new ProfileImportError('PROFILE_UNAVAILABLE', 'The profile is private or unavailable.');
      if (response.status !== 200) throw new ProfileImportError('UPSTREAM_ERROR', `Kinopoisk returned HTTP ${response.status}.`);
      return response;
    }
    throw new ProfileImportError('UPSTREAM_ERROR', 'Kinopoisk could not be reached.');
  }

  async importProfile(input: string, options: Options = {}): Promise<ProfileImport> {
    const alias = parseKinopoiskProfile(input);
    const deadline = this.now() + (options.maxDurationMs ?? 240_000);
    const films = new Map<number, FilmData>();
    let total: number | undefined, pages = 0, offset = 0, source: ProfileImport['source'] = 'android';
    const warnings: string[] = [];
    while (true) {
      const { data } = await this.fetch(requestBody(alias, offset, source), deadline);
      if (!object(data)) return schemaError();
      if (Array.isArray(data.errors) && data.errors.length) {
        const messages = data.errors.map((e: any) => String(e?.message ?? '')).join(' ');
        if (source === 'android' && /query.*not allowed|persistedquerynotfound|unknown operation/i.test(messages)) {
          source = 'website'; warnings.push('Website fallback used; reaction timestamps may be unavailable.'); continue;
        }
        if (/private|anonymous|authentication|access denied|forbidden|not found/i.test(messages)) {
          throw new ProfileImportError('PROFILE_UNAVAILABLE', 'The profile is private or unavailable.');
        }
        throw new ProfileImportError('SCHEMA_CHANGED', 'Kinopoisk rejected the profile query.');
      }
      if (!object(data.data) || !('userProfileBySocialAlias' in data.data)) return schemaError();
      const profile = data.data.userProfileBySocialAlias;
      if (profile === null) throw new ProfileImportError('PROFILE_UNAVAILABLE', 'The profile is private or does not exist.');
      const list = profile?.userData?.movieReactions;
      if (!object(list) || !Number.isSafeInteger(list.total) || list.total < 0 || !Array.isArray(list.items)
        || list.items.length > PAGE_SIZE || list.offset !== offset || list.limit !== PAGE_SIZE) return schemaError();
      if (total !== undefined && total !== list.total) throw new ProfileImportError('PROFILE_CHANGED', 'The profile changed during import; please retry.');
      total = list.total as number;
      if (offset + list.items.length > total || (list.items.length < PAGE_SIZE && offset + list.items.length < total)) {
        throw new ProfileImportError('INCOMPLETE_IMPORT', 'Kinopoisk returned an incomplete page.');
      }
      for (const item of list.items) {
        const film = parseFilm(item);
        if (films.has(film.kinopoiskId)) throw new ProfileImportError('INCOMPLETE_IMPORT', 'Repeated entries detected; please retry.');
        films.set(film.kinopoiskId, film);
      }
      pages++;
      await options.onProgress?.({ collected: films.size, total, pages });
      if (films.size === total) return { alias, films: [...films.values()], collected: films.size, total, pages, source, warnings };
      offset += PAGE_SIZE;
      await this.sleep(250);
    }
  }
}

export const kinopoiskProfileClient = new KinopoiskProfileClient();
