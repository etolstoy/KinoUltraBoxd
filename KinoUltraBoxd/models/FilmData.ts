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
  type: 'film' | 'series';
  kinopoiskId: number;
  tmdbId: number | null;
  imdbId: number | null;
  potentialMatches?: PotentialMatch[];
} 