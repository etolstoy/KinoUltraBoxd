import { Telegraf } from 'telegraf';
import { Message } from 'telegraf/typings/core/types/typegram';
import * as dotenv from 'dotenv';
import { handleProfileImport } from './profileImportHandler';
import { PROFILE_VISIBILITY_HELP } from './messages';

dotenv.config();

export const bot = new Telegraf(process.env.BOT_TOKEN as string, { handlerTimeout: 290_000 });

bot.start(async ctx => {
  await ctx.reply(
    '🎬 Привет! Я помогу перенести оценки, просмотренные фильмы и «Буду смотреть» с Кинопоиска на Letterboxd.\n\nПришли ссылку на свой профиль — я подготовлю два CSV для импорта.\n\nПример: https://www.kinopoisk.ru/user/2425315/\n\nПодробности: /help',
  );
});

bot.help(async ctx => {
  await ctx.reply(
    'Как перенести фильмы\n\n1. Открой свой профиль на Кинопоиске и скопируй ссылку: https://www.kinopoisk.ru/user/12345/\n2. Пришли ссылку сюда. Можно также отправить ID или уникальный адрес профиля. Экспорт начнётся автоматически.\n\nЯ пришлю:\n• letterboxd-watched.csv — оценки и просмотренные фильмы.\n• letterboxd-watchlist.csv — фильмы из «Буду смотреть».\n• kinopoisk-backup.json — полную резервную копию.\n• not_found_films.txt — список пропущенных записей, если они есть.\n\nСначала загрузи letterboxd-watched.csv на https://letterboxd.com/import/ — эти фильмы будут отмечены просмотренными.\n\nЗатем открой https://letterboxd.com/watchlist/ → Import films to watchlist, загрузи letterboxd-watchlist.csv, проверь совпадения и нажми Add films to watchlist. Уже имеющиеся фильмы не дублируются.\n\nЕсли список пуст или для него нет надёжных совпадений, его CSV не отправляется. Если один список не удалось загрузить, я сообщу об этом отдельно.\n\n' + PROFILE_VISIBILITY_HELP + '\n\nСериалы сохраняются в резервной копии, но не попадают в CSV. Даты выставления оценок не превращаются в даты просмотра.\n\nЕсли что-то не получается — напиши @etolstoy.',
  );
});

bot.on('document', async ctx => {
  await ctx.reply('Пришли ссылку на свой профиль Кинопоиска, его ID или уникальный адрес — я загружу список сам.');
});

// Dismiss buttons remaining in older chat messages and point to the current flow.
bot.on('callback_query', async ctx => {
  await ctx.answerCbQuery('Пришли ссылку на свой профиль Кинопоиска.');
  await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
});

bot.on('text', async ctx => {
  await handleProfileImport(ctx, (ctx.message as Message.TextMessage).text);
});

if (!process.env.VERCEL && require.main === module) {
  bot.launch();
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

export default bot;
