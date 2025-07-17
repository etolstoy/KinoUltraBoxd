import { Telegraf, Context } from 'telegraf';
import { Message } from 'telegraf/typings/core/types/typegram';
import * as dotenv from 'dotenv';
import * as https from 'https';

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN as string);

bot.start((ctx: Context) => ctx.reply('Hello'));

bot.on('document', async (ctx: Context) => {
  const doc = (ctx.message as Message.DocumentMessage).document;

  // Show temporary status message
  const statusMsg = await ctx.reply('📥 Downloading and reading your file...');

  try {
    // Get file link from Telegram
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);

    // Download the file into memory
    let data = '';
    https.get(fileLink.href, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', async () => {
        const lines = data.split(/\r?\n/);
        const totalLines = lines.length;
        await ctx.reply(`Total lines: ${totalLines}`);
        await ctx.deleteMessage(statusMsg.message_id);
      });
      res.on('error', async () => {
        await ctx.reply('❌ Error reading the file.');
        await ctx.deleteMessage(statusMsg.message_id);
      });
    }).on('error', async () => {
      await ctx.reply('❌ Error downloading the file.');
      await ctx.deleteMessage(statusMsg.message_id);
    });
  } catch (err) {
    await ctx.reply('❌ Failed to process the file.');
    await ctx.deleteMessage(statusMsg.message_id);
  }
});

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM')); 