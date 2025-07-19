import { Telegraf, Context, Markup } from 'telegraf';
import { Message } from 'telegraf/typings/core/types/typegram';
import * as dotenv from 'dotenv';
import { downloadHtmlFiles } from './services/telegramFileService';
import { process as processFilms } from './services/filmProcessingService';
import { registerSelectionHandler } from './manualSelectionHandler';
import { BotSessionState } from './models/SessionModels';
import { sessionManager } from './services/sessionManager';
import { buildStatsReport } from './services/statsReportService';
import { generateLetterboxdCsv } from './services/letterboxdExportService';
import { FilmData } from './models/FilmData';

dotenv.config();

export const bot = new Telegraf(process.env.BOT_TOKEN as string);

// Start command with inline "Start export" button
bot.start(async (ctx: Context) => {
  // Reset any previously uploaded files when /start is invoked
  const userId = ctx.from?.id;
  if (userId) {
    const session = await loadState(userId);
    session.fileQueue = { file_ids: [], file_names: [] };
    await saveState(userId, session);
  }
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Начать экспорт', 'export_start')],
  ]);

  await ctx.reply(
    '🎬 Привет! Я помогу тебе импортировать фильмы с Кинопоиска на Letterboxd. Для начала отправь мне HTML-файлы с твоими оценками. Чтобы узнать, откуда их взять, вызови команду /help\n\nКогда ты загрузишь файлы, нажми ✅ кнопку под этим сообщением. А если вдруг что-то пойдет не так, напиши @etolstoy!',
    keyboard,
  );
});

// ---------------- Session & persistence layer ----------------
const loadState = (userId: number) => sessionManager.get(userId);
const saveState = (userId: number, state: BotSessionState) => sessionManager.set(userId, state);

// ---------------- Help command ----------------
const helpMessage = `1️⃣ Открой страницу со своими оценками на Кинопоиске:\n• Перейди на [сайт Кинопоиска](https://www.kinopoisk.ru/)\n• Войди в свой аккаунт\n• Нажми на свой аватар в правом верхнем углу\n• Выберите "Оценки"\n\n2️⃣ Настрой отображение максимального количества фильмов на странице:\n• В правом верхнем углу списка фильмов найди выпадающее меню\n• Выбери отображение по 200 фильмов на странице\n\n3️⃣ Сохрани страницу как HTML-файл:\n• В Chrome/Edge: Правая кнопка мыши → Сохранить как... → Выбери "Веб-страница, полностью"\n• В Firefox: Правая кнопка мыши → Сохранить страницу как... → Выбери "Веб-страница, полностью"\n• В Safari: Файл → Сохранить как... → Выбери формат "Веб-архив"\n• Сохрани файл в удобное место на вашем компьютере\n\n4️⃣ Если получилось больше 200 оцененных фильмов:\n• Перейди на следующую страницу с помощью пагинации внизу списка\n• Повтори процесс сохранения для каждой страницы\n• Рекомендуется называть файлы последовательно (например, kinopoisk1.html, kinopoisk2.html)\n\n5️⃣ Повтори то же самое для просмотренных, но не оцененных фильмов:\n• В выпадающем меню "показать" поменяй "оценки" на "просмотры"\n• Сохрани каждую страницу по тому же алгоритму\n\n6️⃣ Загрузи все сохраненные HTML-файлы в этот чат:\n• Нажми на скрепку (📎) в поле ввода сообщения\n• Выбери "Файл"\n• Найди и выбери сохраненные HTML-файлы\n• Отправь их в чат\n`;

bot.command('help', async (ctx: Context) => {
  await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
});

// ---------------- Helper ----------------
// Remove previously saved temporary status message (if any)
async function clearTempStatus(ctx: Context, session: BotSessionState): Promise<void> {
  if (session.tempStatusMessageId) {
    try {
      await ctx.telegram.deleteMessage(ctx.chat!.id, session.tempStatusMessageId);
    } catch (_) {
      // Ignore deletion errors (message might be too old or already deleted)
    }
    delete (session as any).tempStatusMessageId;
    await saveState(ctx.from!.id, session);
  }
}

async function sendStatsReport(ctx: Context, films: FilmData[]): Promise<void> {
  const session = await loadState(ctx.from!.id);
  await clearTempStatus(ctx, session);

  const report = buildStatsReport(films);
  await ctx.reply(report.message, { parse_mode: 'Markdown' });
  if (report.notFoundFilms && report.notFoundFilms.length > 0) {
    const buffer = Buffer.from(report.notFoundFilms.join('\n'), 'utf-8');
    await ctx.replyWithDocument({ source: buffer, filename: 'not_found_films.txt' });
  }

  // Export CSV for Letterboxd
  if (report.stats.exportableCount > 0) {
    const csvBuffer = generateLetterboxdCsv(films);
    await ctx.replyWithDocument({ source: csvBuffer, filename: 'letterboxd.csv' });
  }
}

// Register manual selection handler
registerSelectionHandler(bot, sendStatsReport);

bot.on('document', async (ctx: Context) => {
  const doc = (ctx.message as Message.DocumentMessage).document;
  const userId = ctx.from?.id;
  if (!userId) return;

  // Queue the file for this user (persisted)
  const session = await loadState(userId);
  session.fileQueue.file_ids.push(doc.file_id);
  session.fileQueue.file_names.push(doc.file_name || 'unnamed.html');
  await saveState(userId, session);
});

// Helper processing function reused in multiple places
async function processQueuedFiles(ctx: Context, session: BotSessionState): Promise<void> {
  const queue = session.fileQueue;
  if (!queue || queue.file_ids.length === 0) {
    await clearTempStatus(ctx, session);
    await ctx.reply('❌ Кажется, ты еще не отправил файлы. Пожалуйста, попробуй их прислать еще раз.');
    return;
  }

  // Suppress noisy progress message – keep chat concise while processing files

  let htmlContents: string[] = [];
  try {
    htmlContents = await downloadHtmlFiles(ctx.telegram, queue.file_ids);
  } catch (err) {
    console.error('[bot] file download failed', err);
    await clearTempStatus(ctx, session);
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
      await clearTempStatus(ctx, session);
      await sendStatsReport(ctx, films);
      await sessionManager.clearSelection(ctx.from!.id);
    } else {
      // Save state and start interactive selection
      // Inform user about auto-processed films vs those requiring manual disambiguation
      const processedCount = films.filter((f) => f.tmdbId != null || f.imdbId != null).length;
      const manualCount = films.filter((f) => f.type === 'film' && f.tmdbId == null && f.imdbId == null).length;
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Погнали разбираться', 'manual_start')],
        [Markup.button.callback('🛑 Пропустить все', 'skip_all')],
      ]);

      await clearTempStatus(ctx, session);
      await ctx.reply(
        `👍 Хорошие новости – я автоматически обработал ${processedCount} фильмов, и они уже готовы к импорту на Letterboxd!\n\nНо еще ${manualCount} надо обсудить с тобой. Сможешь помочь выбрать из нескольких совпадений?`,
        keyboard,
      );

      session.selection = {
        films,
        selectionQueue: needManual.map(({ idx }) => idx),
        currentIdx: 0,
      };
      await saveState(ctx.from!.id, session);
    }

    // Success → clear queue
    session.fileQueue = { file_ids: [], file_names: [] };
    await saveState(ctx.from!.id, session);
  } catch (err: any) {
    if (err instanceof Error && err.message === 'KIN_TOKEN_MISSING') {
      // Ask user for token and keep queue intact
      await clearTempStatus(ctx, session);
      const tokenRequestMsg = await ctx.reply(
        '🙋🏻 Часть фильмов уже обработана, но найти пока получилось не все. Нам придется использовать неофициальный API Кинопоиска, для работы с которым тебе надо получить личный токен. Это бесплатно и очень просто – напиши @kinopoiskdev_bot, и меньше чем за минуту токен будет у тебя. Пришли его в ответ на это сообщение, и я продолжу!',
      );
      // Treat the token request as a temporary status message to keep the chat clean later
      session.tempStatusMessageId = (tokenRequestMsg as any).message_id;
      session.awaitingKinopoiskToken = true;
      await saveState(ctx.from!.id, session);
      return;
    }

    console.error('[bot] film processing failed', err);
    await clearTempStatus(ctx, session);
    await ctx.reply('❌ Какие-то проблемы с обработкой файлов. Попробуй еще раз или напиши @etolstoy!');
  }
}

bot.hears(/^go$/i, async (ctx: Context) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const session = await loadState(userId);
  await processQueuedFiles(ctx, session);
});

// Handle "Start export" button press
bot.action('export_start', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  const session = await loadState(userId);

  // If there are no queued files, keep the button and inform the user
  if (!session.fileQueue || session.fileQueue.file_ids.length === 0) {
    await ctx.answerCbQuery('❌ Сначала отправь HTML-файлы для обработки', { show_alert: true });
    return; // do NOT remove the button
  }

  await ctx.answerCbQuery(); // acknowledge button press

  // Remove the button but keep the original message
  try {
    await ctx.editMessageReplyMarkup(undefined);
  } catch (_) {
    // Ignore errors (e.g., if message too old to edit)
  }

  // Show temporary processing status
  const statusMsg = await ctx.reply('⏰ Начал обработку твоих фильмов. Скоро все будет!');
  session.tempStatusMessageId = (statusMsg as any).message_id;
  await saveState(userId, session);

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

  // Remove the user's message containing the sensitive token to keep the chat history clean
  try {
    // deleteMessage without params deletes the message that triggered the current ctx
    await ctx.deleteMessage();
  } catch (_) {
    // Ignore deletion errors (e.g., insufficient rights or message too old)
  }

  session.kinopoiskToken = token;
  session.awaitingKinopoiskToken = false;
  await saveState(userId, session);

  await clearTempStatus(ctx, session);

  // Send a new temporary status message while continuing processing
  const processingMsg = await ctx.reply('🔐 Отлично, спасибо за токен! Продолжаю обработку файлов...');
  session.tempStatusMessageId = (processingMsg as any).message_id;
  await saveState(userId, session);

  // Retry processing queue automatically
  await processQueuedFiles(ctx, session);
});

if (!process.env.VERCEL) {
  bot.launch();

  // Enable graceful stop when running locally (long polling)
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

export default bot; 