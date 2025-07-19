import { FilmData } from '../models/FilmData';

interface ExportStats {
  /** Всего записей в загруженном профиле Кинопоиска */
  totalEntries: number;
  /** Записей, которые будут экспортированы (есть imdbId или tmdbId) */
  exportableCount: number;
  /** Пропущено (нет ни imdbId, ни tmdbId) */
  skippedCount: number;
  /** Количество сериалов */
  seriesCount: number;
  /** Количество фильмов без найденных идентификаторов */
  unmatchedFilmCount: number;
  /** Экспортируемых записей с оценкой пользователя */
  ratedCount: number;
  /** Экспортируемых записей без оценки пользователя */
  unratedCount: number;
  /** Средняя пользовательская оценка по экспортируемым фильмам с оценкой */
  averageRating: number;
}

function computeStats(films: FilmData[]): ExportStats {
  const totalEntries = films.length;
  const hasAnyId = (f: FilmData) => f.imdbId != null || f.tmdbId != null;
  const withoutAnyId = (f: FilmData) => f.imdbId == null && f.tmdbId == null;

  const exportableCount = films.filter(hasAnyId).length;
  const skippedCount = films.filter(withoutAnyId).length;
  const seriesCount = films.filter((f) => f.type === 'series').length;
  const unmatchedFilmCount = films.filter((f) => f.type === 'film' && withoutAnyId(f)).length;
  const rated = films.filter((f) => hasAnyId(f) && f.rating != null && f.rating > 0);
  const ratedCount = rated.length;
  const unratedCount = films.filter((f) => hasAnyId(f) && (f.rating == null || f.rating === 0)).length;

  const averageRating = ratedCount === 0 ? 0 : rated.reduce((sum, f) => sum + (f.rating || 0), 0) / ratedCount;

  return {
    totalEntries,
    exportableCount,
    skippedCount,
    seriesCount,
    unmatchedFilmCount,
    ratedCount,
    unratedCount,
    averageRating,
  };
}

function buildStatsMessage(stats: ExportStats): string {
  const lines: string[] = [];

  lines.push('✅ Побег из Кинопоиска завершился успешно! Скачай файл с оценками и импортируй из на Letterboxd вот по [этой инструкции](https://letterboxd.com/import/).');
  lines.push('');
  lines.push(`• Всего записей в загруженном профиле Кинопоиска: ${stats.totalEntries}`);
  lines.push(`• Из них на Letterboxd попадут: ${stats.exportableCount}`);
  lines.push(`• С оценками: ${stats.ratedCount}`);
  lines.push(`• Без оценок: ${stats.unratedCount}`);
  lines.push(`• Средняя оценка: ${stats.averageRating.toFixed(2)}`);

  if (stats.skippedCount > 0) {
    lines.push('');
    lines.push(`Экспортировать получилось не все. Всего пропущено записей: ${stats.skippedCount}. Из них:`);

    if (stats.seriesCount !== 0) {
      lines.push(`• Сериалы: ${stats.seriesCount}`);
      lines.push('Letterboxd не поддерживает сериалы. Можешь попробовать переехать с ними на сервис MyShows.');
    }

    if (stats.unmatchedFilmCount !== 0) {
      lines.push(`• Фильмы, которые не получилось найти: ${stats.unmatchedFilmCount}`);
      lines.push('Попробуй найти и добавить их на Letterboxd вручную. Список пришлю отдельным файлом!');
    }
  }

  return lines.join('\n');
}

/**
 * Формирует итоговый отчёт и список «потеряшек» (если такие есть).
 * Отправку сообщения/файла оставляем на слои бота.
 */
export function buildStatsReport(
  films: FilmData[],
): { message: string; notFoundFilms?: string[]; stats: ExportStats } {
  const stats = computeStats(films);
  const message = buildStatsMessage(stats);

  let notFoundFilms: string[] | undefined;
  if (stats.unmatchedFilmCount > 0 || stats.seriesCount > 0) {
    // Build a single Markdown file with two sections: Films and Series
    notFoundFilms = [];

    const appendEntry = (f: FilmData) => {
      notFoundFilms!.push(`## ${f.title}`);
      notFoundFilms!.push(`Тип: ${f.type}`);
      notFoundFilms!.push(`Год выпуска: ${f.year != null ? f.year : '—'}`);
      notFoundFilms!.push(`Идентификатор на Кинопоиске: ${f.kinopoiskId}`);
      notFoundFilms!.push(`Ваша оценка: ${f.rating != null ? f.rating : '—'}`);
      notFoundFilms!.push(`Дата просмотра: ${f.watchDate ?? '—'}`);
      notFoundFilms!.push(''); // readability spacer
    };

    if (stats.unmatchedFilmCount > 0) {
      notFoundFilms.push('# Films');
      notFoundFilms.push('');
      films
        .filter((f) => f.type === 'film' && f.imdbId == null && f.tmdbId == null)
        .forEach(appendEntry);
    }

    if (stats.seriesCount > 0) {
      notFoundFilms.push('# Series');
      notFoundFilms.push('');
      // List all series (Letterboxd does not support series at all)
      films.filter((f) => f.type === 'series').forEach(appendEntry);
    }
  }

  return { message, notFoundFilms, stats };
} 