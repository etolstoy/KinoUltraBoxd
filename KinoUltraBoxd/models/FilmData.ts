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
} 