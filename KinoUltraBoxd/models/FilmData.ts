// Define shape for potential TMDB matches that can help with manual disambiguation
export class PotentialMatch {
  constructor(
    public title: string,
    public year: number | null,
    public tmdbId: number | null,
    public popularity: number | null,
    public description: string | null,
  ) {}

  /** Direct link to the movie page on TMDB (null when id is unavailable) */
  get tmdbUrl(): string | null {
    return this.tmdbId != null ? `https://www.themoviedb.org/movie/${this.tmdbId}` : null;
  }
}

/**
 * Canonical representation of a Kinopoisk entry enriched through the pipeline.
 * All fields are public for easy structural cloning / spreading, but the
 * computation-heavy logic (like constructing the KP URL) lives on the class
 * prototype so every instance shares it.
 */
export class FilmData {
  constructor(
    public title: string,
    public year: number | null,
    public rating: number | null,
    public watchDate: string | null,
    public type: 'film' | 'series',
    public kinopoiskId: number,
    public tmdbId: number | null = null,
    public imdbId: number | null = null,
    public potentialMatches?: PotentialMatch[],
  ) {}

  /** Direct link to the film/series page on Kinopoisk */
  get kinopoiskUrl(): string {
    return `https://www.kinopoisk.ru/${this.type}/${this.kinopoiskId}`;
  }

  /** Direct link to the movie page on TMDB (null when tmdbId is missing) */
  get tmdbUrl(): string | null {
    return this.tmdbId != null ? `https://www.themoviedb.org/movie/${this.tmdbId}` : null;
  }

  /** Direct link to the movie/series page on IMDb (null when imdbId is missing) */
  get imdbUrl(): string | null {
    return this.imdbId != null ? `https://www.imdb.com/title/${this.imdbId}` : null;
  }

  /**
   * Lightweight helper to clone an existing FilmData while overriding selected
   * fields – keeps enrichment stages concise and immutable.
   */
  static clone(base: FilmData, overrides: Partial<Omit<FilmData, 'kinopoiskUrl'>> = {}): FilmData {
    return new FilmData(
      overrides.title ?? base.title,
      overrides.year ?? base.year,
      overrides.rating ?? base.rating,
      overrides.watchDate ?? base.watchDate,
      overrides.type ?? base.type,
      overrides.kinopoiskId ?? base.kinopoiskId,
      overrides.tmdbId ?? base.tmdbId,
      overrides.imdbId ?? base.imdbId,
      overrides.potentialMatches ?? base.potentialMatches,
    );
  }
} 