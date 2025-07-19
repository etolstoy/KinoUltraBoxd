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

const bot = new Telegraf(process.env.BOT_TOKEN as string);

bot.start((ctx: Context) => ctx.reply('🎬 Привет! Я помогу тебе импортировать фильмы с Кинопоиска на Letterboxd. Для начала отправь мне HTML-файлы с твоими оценками. Чтобы узнать, как это сделать, напиши /help!\n\nКогда загрузишь файлы и будешь готов начать, нажми на кнопку "✅ Начать экспорт". А если вдруг что-то пойдет не так, напиши @etolstoy!'));

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

  // Show temporary status message
  const statusMsg = await ctx.reply('📥 Скачиваю и проверяю файл...');

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
    await ctx.reply('❌ Кажется, ты еще не отправил файлы. Пожалуйста, попробуй их прислать еще раз.');
    return;
  }

  // Suppress noisy progress message – keep chat concise while processing files

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
      // Inform user about auto-processed films vs those requiring manual disambiguation
      const processedCount = films.filter((f) => f.tmdbId != null || f.imdbId != null).length;
      const manualCount = films.filter((f) => f.type === 'film' && f.tmdbId == null && f.imdbId == null).length;
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🙋‍♂️ Выбрать вручную', 'manual_start')],
        [Markup.button.callback('🛑 Пропустить все', 'skip_all')],
      ]);

      await ctx.reply(
        `👍 Хорошие новости – я автоматически обработал ${processedCount} фильмов, и они уже готовы к импорту на Letterboxd!\n\nНо есть вопросики к ${manualCount} фильмов, нужна твоя помощь. Что будем делать?`,
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
      await ctx.reply('🙋🏻 Часть фильмов уже обработана, но найти пока получилось не все. Нам придется использовать неофициальный API Кинопоиска, для работы с которым тебе надо получить личный токен. Это бесплатно и очень просто – напиши @kinopoiskdev_bot, и меньше чем за минуту токен будет у тебя. Пришли его в ответ на это сообщение, и я продолжу!');
      session.awaitingKinopoiskToken = true;
      await saveState(ctx.from!.id, session);
      return;
    }

    console.error('[bot] film processing failed', err);
    await ctx.reply('❌ Какие-то проблемы с обработкой файлов. Попробуй еще раз или напиши @etolstoy!');
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

  await ctx.reply('🔐 Отлично, спасибо за токен! Продолжаю обработку файлов...');

  // Retry processing queue automatically
  await processQueuedFiles(ctx, session);
});

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM')); 