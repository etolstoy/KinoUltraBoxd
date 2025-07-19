import { Telegraf, Context, Markup } from 'telegraf';
import { Message } from 'telegraf/typings/core/types/typegram';
import * as dotenv from 'dotenv';
import * as https from 'https';
import { process as processFilms } from './services/filmProcessingService';
import { FilmData } from './models/FilmData';
import { BotSessionState, FileQueue, SelectionState } from './models/SessionModels';
import { sessionManager } from './services/SessionManager';

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN as string);

bot.start((ctx: Context) => ctx.reply('Hello'));

// ---------------- Session & persistence layer ----------------
const loadState = (userId: number) => sessionManager.get(userId);
const saveState = (userId: number, state: BotSessionState) => sessionManager.set(userId, state);

// Helper to prompt user to choose a match for the current film
async function promptNextFilm(ctx: Context) {
  const userId = ctx.from?.id;
  if (!userId) return;
  const session = await loadState(userId);
  const state = session.selection;
  if (!state) return;

  // Completed all selections → cleanup and notify user
  if (state.currentIdx >= state.selectionQueue.length) {
    await ctx.reply('🎉 Все фильмы обработаны. Спасибо!');
    await sessionManager.clearSelection(userId);
    return;
  }

  const filmIdx = state.selectionQueue[state.currentIdx];
  const film = state.films[filmIdx];
  const matches = film.potentialMatches ?? [];
  // Compose message body
  const lines: string[] = [
    `Пожалуйста, выберите правильный вариант для записи с кинопоиска для фильма "${film.title}"`,
  ];
  matches.forEach((m, idx) => {
    const yearPart = m.year ? `(${m.year})` : '';
    const descrPart = m.description ? ` – ${m.description}` : '';
    lines.push(`${idx + 1}. ${m.title} ${yearPart}${descrPart}`);
  });

  // Build inline keyboard: one button per match (max 9)
  const keyboard = Markup.inlineKeyboard(
    matches.map((_, idx) => Markup.button.callback(String(idx + 1), `choose_${filmIdx}_${idx}`)),
    { columns: 3 },
  );

  await ctx.reply(lines.join('\n'), keyboard);
}

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

  const htmlContents: string[] = [];

  for (let i = 0; i < queue.file_ids.length; i++) {
    const file_id = queue.file_ids[i];
    const file_name = queue.file_names[i];
    try {
      const fileLink = await ctx.telegram.getFileLink(file_id);
      let data = '';
      await new Promise<void>((resolve, reject) => {
        https.get(fileLink.href, (res) => {
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            resolve();
          });
          res.on('error', reject);
        }).on('error', reject);
      });
      htmlContents.push(data);
      const lines = data.split(/\r?\n/);
      const totalLines = lines.length;
      await ctx.reply(`File: ${file_name}\nTotal lines: ${totalLines}`);
    } catch (err) {
      await ctx.reply(`❌ Error processing file: ${file_name}`);
    }
  }

  // Call the film processing service with all HTML contents
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

// Handle inline button selection
bot.action(/^choose_(\d+)_(\d+)$/, async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const session = await loadState(userId);
  const state = session.selection;
  if (!state) {
    await ctx.answerCbQuery('Нет активного выбора.');
    return;
  }

  const filmIdx = Number(ctx.match[1]);
  const matchIdx = Number(ctx.match[2]);

  const film = state.films[filmIdx];
  const match = film.potentialMatches?.[matchIdx];
  if (!match) {
    await ctx.answerCbQuery('Неверный выбор.');
    return;
  }

  // Apply chosen match to FilmData
  film.title = match.title;
  film.year = match.year;
  // Update TMDB id if present (used later in pipeline)
  if (match.tmdbId != null) {
    film.tmdbId = match.tmdbId;
  }

  // Advance state and prompt next film (if any)
  state.currentIdx += 1;
  session.selection = state;
  await saveState(userId, session);
  await ctx.answerCbQuery('✅ Выбран вариант сохранён');

  // Remove keyboard from the message user interacted with to keep chat clean
  try {
    await ctx.editMessageReplyMarkup(undefined);
  } catch { /* message might be already edited */ }

  // Prompt next film or finish
  await promptNextFilm(ctx);
});

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM')); 