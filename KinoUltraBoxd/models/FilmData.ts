// Define shape for potential TMDB matches that can help with manual disambiguation
export interface PotentialMatch {
  title: string;
  year: number | null;
  tmdbId: number | null;
  popularity: number | null;
  description: string | null;
}

export interface FilmData {
  title: string;
  year: number | null;
  rating: number | null;
  watchDate: string | null;
  /** Indicates whether the entry is a film or a series */
  type: 'film' | 'series';
  kinopoiskId: number;
  tmdbId: number | null;
  imdbId: number | null;
  /** List of potential TMDB search matches that could correspond to this film */
  potentialMatches?: PotentialMatch[];
} 