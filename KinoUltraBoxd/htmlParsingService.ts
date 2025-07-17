import * as cheerio from 'cheerio';

/**
 * Parses provided HTML files and extracts kinopoiskIds from valid Kinopoisk pages.
 * @param htmlFiles Array of HTML file contents as strings
 * @returns Array of kinopoiskIds (number)
 */
export function parseKinopoiskIdsFromHtmlFiles(htmlFiles: string[]): number[] {
  const allIds: number[] = [];

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

    items.each((_: number, el: cheerio.Element) => {
      const idStr = $(el).attr('data-id');
      if (idStr && /^\d+$/.test(idStr)) {
        allIds.push(Number(idStr));
      }
    });
  });

  console.log('[htmlParsingService] function end');
  return allIds;
} 