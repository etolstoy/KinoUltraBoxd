import type { VercelRequest, VercelResponse } from '@vercel/node';
import bot from '../KinoUltraBoxd/bot';

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
    await bot.handleUpdate(update as any);
    res.status(200).send('OK');
  } catch (err) {
    console.error('[webhook] failed to handle update', err);
    res.status(500).end();
  }
} 