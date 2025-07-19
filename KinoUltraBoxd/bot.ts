import { Telegraf, Context } from 'telegraf';
import { Message } from 'telegraf/typings/core/types/typegram';
import * as dotenv from 'dotenv';
import { downloadHtmlFiles } from './services/telegramFileService';
import { process as processFilms } from './services/filmProcessingService';
import { promptNextFilm, registerSelectionHandler } from './manualSelectionHandler';
import { BotSessionState, FileQueue, SelectionState } from './models/SessionModels';
import { sessionManager } from './services/SessionManager';

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN as string);

bot.start((ctx: Context) => ctx.reply('Hello'));

// ---------------- Session & persistence layer ----------------
const loadState = (userId: number) => sessionManager.get(userId);
const saveState = (userId: number, state: BotSessionState) => sessionManager.set(userId, state);

// Register manual selection handler
registerSelectionHandler(bot);

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

bot.hears(/^go$/i, async (ctx: Context) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const session = await loadState(userId);
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
    const films = await processFilms(htmlContents);

    // Identify films that need manual disambiguation
    const needManual = films
      .map((f, idx) => ({ film: f, idx }))
      .filter(({ film }) => film.potentialMatches && film.potentialMatches.length > 0);

    if (needManual.length === 0) {
      await ctx.reply(`✅ Processed ${films.length} entries. No manual selection needed.`);
      await sessionManager.clearSelection(userId); // Clear previous selection if any
    } else {
      // Save state and start interactive selection
      session.selection = {
        films,
        selectionQueue: needManual.map(({ idx }) => idx),
        currentIdx: 0,
      };
      await saveState(userId, session);
      await promptNextFilm(ctx);
    }
  } catch (err) {
    console.error('[bot] film processing failed', err);
    await ctx.reply('❌ Failed to process films. Please try again later.');
  }

  // Clear the queue after processing
  session.fileQueue = { file_ids: [], file_names: [] };
  await saveState(userId, session);
});

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM')); 