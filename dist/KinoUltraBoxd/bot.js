"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const telegraf_1 = require("telegraf");
const dotenv = __importStar(require("dotenv"));
const https = __importStar(require("https"));
dotenv.config();
const bot = new telegraf_1.Telegraf(process.env.BOT_TOKEN);
bot.start((ctx) => ctx.reply('Hello'));
// In-memory storage for user file queues
const userFileQueue = {};
bot.on('document', async (ctx) => {
    const doc = ctx.message.document;
    const userId = ctx.from?.id;
    if (!userId)
        return;
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
bot.hears(/^go$/i, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId)
        return;
    const queue = userFileQueue[userId];
    if (!queue || queue.file_ids.length === 0) {
        await ctx.reply('No files queued. Please send HTML files first.');
        return;
    }
    await ctx.reply(`Processing ${queue.file_ids.length} file(s)...`);
    for (let i = 0; i < queue.file_ids.length; i++) {
        const file_id = queue.file_ids[i];
        const file_name = queue.file_names[i];
        try {
            const fileLink = await ctx.telegram.getFileLink(file_id);
            let data = '';
            await new Promise((resolve, reject) => {
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
            const lines = data.split(/\r?\n/);
            const totalLines = lines.length;
            await ctx.reply(`File: ${file_name}\nTotal lines: ${totalLines}`);
        }
        catch (err) {
            await ctx.reply(`❌ Error processing file: ${file_name}`);
        }
    }
    // Clear the queue after processing
    userFileQueue[userId] = { file_ids: [], file_names: [] };
});
bot.launch();
// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
