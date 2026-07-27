// htmlParsingService.ts (moved to services folder)
import * as cheerio from 'cheerio';
import { FilmData } from '../models/FilmData';

/**
 * Detects and decodes MHTML (MIME HTML) content into plain HTML.
 * MHTML files use quoted-printable encoding and MIME multipart structure.
 */
function decodeMhtmlIfNeeded(content: string): string {
  if (!content.includes('Content-Type: multipart/related')) {
    return content;
  }

  const boundaryMatch = content.match(/boundary="([^"]+)"/);
  if (!boundaryMatch) return content;

  const boundary = boundaryMatch[1];
  const parts = content.split('--' + boundary);

  for (const part of parts) {
    if (!part.includes('Content-Type: text/html')) continue;

    const bodyStart = part.includes('\r\n\r\n')
      ? part.indexOf('\r\n\r\n') + 4
      : part.indexOf('\n\n') + 2;
    const qpBody = part.slice(bodyStart);

    // Decode quoted-printable: join soft line breaks, then decode =XX hex bytes as UTF-8
    const joined = qpBody.replace(/=\r\n/g, '').replace(/=\n/g, '');
    const bytes: number[] = [];
    let i = 0;
    while (i < joined.length) {
      if (joined[i] === '=' && i + 2 < joined.length && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
        bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
        i += 3;
      } else {
        bytes.push(joined.charCodeAt(i));
        i++;
      }
    }
    return Buffer.from(bytes).toString('utf8');
  }

  return content;
}

/**
 * Parses provided HTML files and extracts kinopoiskIds from valid Kinopoisk pages.
 * @param htmlFiles Array of HTML file contents as strings
 * @returns Array of FilmData objects containing kinopoiskId and type
 */
export function parseKinopoiskIdsFromHtmlFiles(htmlFiles: string[]): FilmData[] {
  const results: FilmData[] = [];

  htmlFiles.forEach((rawHtml, idx) => {
    const html = decodeMhtmlIfNeeded(rawHtml);
    const $ = cheerio.load(html);
    const hasProfileFilmsList = $('.profileFilmsList').length > 0;
    const hasItemList = $('#itemList').length > 0;
    const hasKinopoiskHeader = $('meta[property="og:site_name"]').attr('content')?.includes('Кинопоиск') || false;

    let items = $('.profileFilmsList .item');
    if (items.length === 0) {
      items = $('#itemList li.item');
    }
    if (items.length === 0 && (hasProfileFilmsList || hasItemList)) {
      items = $('.item');
    }
    const hasItems = items.length > 0;

    console.log(`[htmlParsingService] File #${idx + 1}: hasProfileFilmsList=${hasProfileFilmsList}, hasItemList=${hasItemList}, hasKinopoiskHeader=${hasKinopoiskHeader}, itemsCount=${items.length}`);

    if (!((hasProfileFilmsList || hasItemList || hasItems) && hasKinopoiskHeader && hasItems)) {
      console.warn(`[htmlParsingService] File #${idx + 1} is not a valid Kinopoisk ratings/watched films page. Skipping.`);
      return;
    }

    // Extract Kinopoisk ID and determine film/series type.
    items.each((_: number, el: cheerio.Element) => {
      let idStr: string | undefined = undefined;
      let entryType: 'film' | 'series' | undefined = undefined;
      let title = '';
      let year: number | null = null;
      let watchDate: string | null = null;
      let rating: number | null = null;

      // 1) Newer markup may keep id right on the .item element
      idStr = $(el).attr('data-id');

      // 2) Mobile / alternative markup keeps it on a nested selector with attribute "mid"
      if (!idStr) {
        const midAttr = $(el).find('[mid]').attr('mid');
        if (midAttr) idStr = midAttr;
      }

      // 3) Watchlist markup may use id attribute on the element (e.g., id="film_4854589")
      if (!idStr) {
        const elementId = $(el).attr('id');
        if (elementId) {
          const match = elementId.match(/(?:film|series)_(\d+)/);
          if (match) idStr = match[1];
        }
      }

      // 4) Determine type & fallback id extraction using the href of first matching link
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

      // Extract title (prefer English, fallback to Russian or general link name)
      const engTitle = $(el).find('.nameEng').text().trim();
      if (engTitle) {
        title = engTitle;
      } else {
        const nameRusEl = $(el).find('.nameRus');
        if (nameRusEl.length > 0) {
          title = nameRusEl.clone().children().remove().end().text().trim();
        } else {
          const nameLinkEl = $(el).find('a.name, .name a, .name').first();
          if (nameLinkEl.length > 0) {
            title = nameLinkEl.text().trim();
          }
        }
      }

      // Extract year from Russian name line or full item text
      const nameRusText = $(el).find('.nameRus').text();
      let yearMatch = nameRusText.match(/\((\d{4})\)[^()]*$/);
      if (!yearMatch) {
        const fullItemText = $(el).text();
        yearMatch = fullItemText.match(/\((\d{4})\)/);
      }
      if (yearMatch) {
        year = Number(yearMatch[1]);
      }

      // Extract watch date and convert to YYYY-MM-DD
      const dateText = $(el).find('.date').first().text().trim();
      const dateMatch = dateText.match(/(\d{2})\.(\d{2})\.(\d{4})/); // dd.mm.yyyy
      if (dateMatch) {
        const [ , dd, mm, yyyy] = dateMatch;
        watchDate = `${yyyy}-${mm}-${dd}`;
      }

      // Extract rating from embedded script blocks
      $(el).find('script').each((__, scriptEl) => {
        const scrText = $(scriptEl).html() || '';
        const rMatch = scrText.match(/rating:\s*'([\d.]+)'/);
        if (rMatch) {
          rating = Number(rMatch[1]);
          return false; // break each loop
        }
        return undefined;
      });

      if (idStr && /^\d+$/.test(idStr) && entryType) {
        const film = new FilmData(
          title,
          year,
          rating,
          watchDate,
          entryType,
          Number(idStr),
        );
        results.push(film);
      }
    });
  });

  console.log('[htmlParsingService] function end');
  return results;
} 