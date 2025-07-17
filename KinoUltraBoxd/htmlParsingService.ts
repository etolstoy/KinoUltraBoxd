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

    // Extract Kinopoisk ID using a few fallbacks because the exact markup may differ
    items.each((_: number, el: cheerio.Element) => {
      let idStr: string | undefined = undefined;

      // 1) Newer markup may keep id right on the .item element
      idStr = $(el).attr('data-id');

      // 2) Mobile / alternative markup keeps it on a nested selector with attribute "mid"
      if (!idStr) {
        const midAttr = $(el).find('[mid]').attr('mid');
        if (midAttr) idStr = midAttr;
      }

      // 3) Fallback: parse the numeric part of the first film/series url inside the item
      if (!idStr) {
        const href = $(el).find('a[href*="/film/"], a[href*="/series/"]').first().attr('href');
        const match = href?.match(/\/(?:film|series)\/(\d+)/);
        if (match) idStr = match[1];
      }

      if (idStr && /^\d+$/.test(idStr)) {
        allIds.push(Number(idStr));
      }
    });
  });

  console.log('[htmlParsingService] function end');
  return allIds;
} 