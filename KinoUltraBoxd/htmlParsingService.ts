import * as cheerio from 'cheerio';
import { FilmData } from './models/FilmData';

/**
 * Parses provided HTML files and extracts kinopoiskIds from valid Kinopoisk pages.
 * @param htmlFiles Array of HTML file contents as strings
 * @returns Array of FilmData objects containing kinopoiskId and type
 */
export function parseKinopoiskIdsFromHtmlFiles(htmlFiles: string[]): FilmData[] {
  const results: FilmData[] = [];

  htmlFiles.forEach((html, idx) => {
    const $ = cheerio.load(html);
    const hasProfileFilmsList = $('.profileFilmsList').length > 0;
    const hasKinopoiskHeader = $('meta[property="og:site_name"]').attr('content')?.includes('Кинопоиск') || false;
    const items = $('.profileFilmsList .item');
    const hasItems = items.length > 0;

    console.log(`[htmlParsingService] File #${idx + 1}: hasProfileFilmsList=${hasProfileFilmsList}, hasKinopoiskHeader=${hasKinopoiskHeader}, hasItems=${hasItems}`);

    if (!(hasProfileFilmsList && hasKinopoiskHeader && hasItems)) {
      console.warn(`[htmlParsingService] File #${idx + 1} is not a valid Kinopoisk ratings/watched films page. Skipping.`);
      return;
    }

    // Extract Kinopoisk ID and determine film/series type.
    items.each((_: number, el: cheerio.Element) => {
      let idStr: string | undefined = undefined;
      let entryType: 'film' | 'series' | undefined = undefined;

      // 1) Newer markup may keep id right on the .item element
      idStr = $(el).attr('data-id');

      // 2) Mobile / alternative markup keeps it on a nested selector with attribute "mid"
      if (!idStr) {
        const midAttr = $(el).find('[mid]').attr('mid');
        if (midAttr) idStr = midAttr;
      }

      // 3) Determine type & fallback id extraction using the href of first matching link
      const href = $(el).find('a[href*="/film/"], a[href*="/series/"]').first().attr('href');
      if (href) {
        if (href.includes('/series/')) entryType = 'series';
        else if (href.includes('/film/')) entryType = 'film';

        // extract id if still missing
        if (!idStr) {
          const match = href.match(/\/(?:film|series)\/(\d+)/);
          if (match) idStr = match[1];
        }
      }

      if (idStr && /^\d+$/.test(idStr) && entryType) {
        const film: FilmData = {
          title: '', // unknown at this stage
          year: null,
          rating: null,
          watchDate: null,
          kinopoiskId: Number(idStr),
          tmdbId: null,
          imdbId: null,
          type: entryType,
        };
        results.push(film);
      }
    });
  });

  console.log('[htmlParsingService] function end');
  return results;
} 