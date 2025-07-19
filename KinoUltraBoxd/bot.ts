import { Telegraf, Context } from 'telegraf';
import { Message } from 'telegraf/typings/core/types/typegram';
import * as dotenv from 'dotenv';
import { downloadHtmlFiles } from './services/telegramFileService';
import { process as processFilms } from './services/filmProcessingService';
import { promptNextFilm, registerSelectionHandler } from './manualSelectionHandler';
import { BotSessionState } from './models/SessionModels';
import { sessionManager } from './services/sessionManager';
import { buildStatsReport } from './services/statsReportService';
import { FilmData } from './models/FilmData';

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN as string);

bot.start((ctx: Context) => ctx.reply('Hello'));

// ---------------- Session & persistence layer ----------------
const loadState = (userId: number) => sessionManager.get(userId);
const saveState = (userId: number, state: BotSessionState) => sessionManager.set(userId, state);

// ---------------- Helper ----------------
async function sendStatsReport(ctx: Context, films: FilmData[]): Promise<void> {
  const report = buildStatsReport(films);
  await ctx.reply(report.message);
  if (report.notFoundFilms && report.notFoundFilms.length > 0) {
    const buffer = Buffer.from(report.notFoundFilms.join('\n'), 'utf-8');
    await ctx.replyWithDocument({ source: buffer, filename: 'not_found_films.txt' });
  }
}

// Register manual selection handler
registerSelectionHandler(bot, sendStatsReport);

bot.on('document', async (ctx: Context) => {
  const doc = (ctx.message as Message.DocumentMessage).document;
  const userId = ctx.from?.id;
  if (!userId) return;

  // Show temporary status message
  const statusMsg = await ctx.reply('📥 Downloading and reading your file...');

  // Queue the file for this user (persisted)
  const session = await loadState(userId);
  session.fileQueue.file_ids.push(doc.file_id);
  session.fileQueue.file_names.push(doc.file_name || 'unnamed.html');
  await saveState(userId, session);

  await ctx.reply(`Queued file: ${doc.file_name || 'unnamed.html'}\nSend 'go' when ready to process all queued files.`);
});

// Helper processing function reused in multiple places
async function processQueuedFiles(ctx: Context, session: BotSessionState): Promise<void> {
  const queue = session.fileQueue;
  if (!queue || queue.file_ids.length === 0) {
    await ctx.reply('No files queued. Please send HTML files first.');
    return;
  }

  await ctx.reply(`Processing ${queue.file_ids.length} file(s)...`);

  let htmlContents: string[] = [];
  try {
    htmlContents = await downloadHtmlFiles(ctx.telegram, queue.file_ids);
  } catch (err) {
    console.error('[bot] file download failed', err);
    await ctx.reply('❌ Не получилось скачать файлы. Попробуйте еще раз.');
    return;
  }

  // ---------- Process downloaded HTML ----------
  try {
    const films = await processFilms(htmlContents, session.kinopoiskToken);

    // Identify films that need manual disambiguation
    const needManual = films
      .map((f, idx) => ({ film: f, idx }))
      .filter(({ film }) => film.potentialMatches && film.potentialMatches.length > 0);

    if (needManual.length === 0) {
      await sendStatsReport(ctx, films);
      await sessionManager.clearSelection(ctx.from!.id);
    } else {
      // Save state and start interactive selection
      session.selection = {
        films,
        selectionQueue: needManual.map(({ idx }) => idx),
        currentIdx: 0,
      };
      await saveState(ctx.from!.id, session);
      await promptNextFilm(ctx);
    }

    // Success → clear queue
    session.fileQueue = { file_ids: [], file_names: [] };
    await saveState(ctx.from!.id, session);
  } catch (err: any) {
    if (err instanceof Error && err.message === 'KIN_TOKEN_MISSING') {
      // Ask user for token and keep queue intact
      await ctx.reply('Please provide token for Kinopoisk API. You can get it for free from @kinopoiskdev_bot, it takes less than a minute');
      session.awaitingKinopoiskToken = true;
      await saveState(ctx.from!.id, session);
      return;
    }

    console.error('[bot] film processing failed', err);
    await ctx.reply('❌ Failed to process films. Please try again later.');
  }
}

bot.hears(/^go$/i, async (ctx: Context) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const session = await loadState(userId);
  await processQueuedFiles(ctx, session);
});

// Capture Kinopoisk token when awaiting
bot.on('text', async (ctx: Context) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  const session = await loadState(userId);
  if (!session.awaitingKinopoiskToken) return; // Not expecting token

  const token = (ctx.message as any).text?.trim();
  if (!token) return;

  session.kinopoiskToken = token;
  session.awaitingKinopoiskToken = false;
  await saveState(userId, session);

  await ctx.reply('🔐 Token saved! Re-processing your files...');

  // Retry processing queue automatically
  await processQueuedFiles(ctx, session);
});

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM')); 