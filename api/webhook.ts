import type { VercelRequest, VercelResponse } from '@vercel/node';
import bot from '../KinoUltraBoxd/bot';
import { waitUntil } from '@vercel/functions';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(200).send('OK');
  }

  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.query.secret !== secret) {
    return res.status(403).send('Forbidden');
  }

  try {
    const update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!update || !Number.isSafeInteger(update.update_id)) return res.status(400).send('Invalid update');
    // Telegram gets an immediate acknowledgement; Vercel keeps the import alive.
    waitUntil(bot.handleUpdate(update as any).catch(() => {
      console.error('[webhook] background update failed');
    }));
    res.status(200).send('OK');
  } catch (err) {
    console.error('[webhook] invalid update');
    res.status(400).end();
  }
}
