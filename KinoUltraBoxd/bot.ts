import { Telegraf, Context } from 'telegraf';
import { Message } from 'telegraf/typings/core/types/typegram';
import * as dotenv from 'dotenv';
import * as https from 'https';
import { process as processFilms } from './filmProcessingService';

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN as string);

bot.start((ctx: Context) => ctx.reply('Hello'));

// In-memory storage for user file queues
const userFileQueue: Record<number, { file_ids: string[], file_names: string[] }> = {};

bot.on('document', async (ctx: Context) => {
  const doc = (ctx.message as Message.DocumentMessage).document;
  const userId = ctx.from?.id;
  if (!userId) return;

  // Show temporary status message
  const statusMsg = await ctx.reply('📥 Downloading and reading your file...');

  // Queue the file for this user
  if (!userFileQueue[userId]) {
    userFileQueue[userId] = { file_ids: [], file_names: [] };
  }
  userFileQueue[userId].file_ids.push(doc.file_id);
  userFileQueue[userId].file_names.push(doc.file_name || 'unnamed.html');

  await ctx.reply(`Queued file: ${doc.file_name || 'unnamed.html'}\nSend 'go' when ready to process all queued files.`);
});

bot.hears(/^go$/i, async (ctx: Context) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const queue = userFileQueue[userId];
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
  processFilms(htmlContents);

  // Clear the queue after processing
  userFileQueue[userId] = { file_ids: [], file_names: [] };
});

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM')); 