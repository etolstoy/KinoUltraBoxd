import { Telegram } from 'telegraf';
import * as https from 'https';

/**
 * Downloads raw HTML content for each Telegram `fileId` provided.
 *
 * The function fetches every file sequentially to avoid hitting Telegram’s
 * **getFileLink** rate-limit.  For each id it resolves the public HTTPS link
 * and streams the response into a single string.
 *
 * If a file fails to download, the error is printed to the console and the
 * file is simply skipped – the caller will receive fewer HTML strings than
 * `fileIds.length` in that case.
 */
export async function downloadHtmlFiles(
  telegram: Telegram,
  fileIds: string[],
): Promise<string[]> {
  const htmlContents: string[] = [];

  for (const fileId of fileIds) {
    try {
      const fileLink = await telegram.getFileLink(fileId);
      const data = await new Promise<string>((resolve, reject) => {
        let buffer = '';
        https
          .get(fileLink.href, (res) => {
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
              buffer += chunk;
            });
            res.on('end', () => resolve(buffer));
            res.on('error', reject);
          })
          .on('error', reject);
      });
      htmlContents.push(data);
    } catch (err) {
      console.error('[telegramFileService] Failed to download file', fileId, err);
    }
  }

  return htmlContents;
} 