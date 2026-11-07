jest.mock('../bot', () => ({ __esModule: true, default: { handleUpdate: jest.fn() } }));
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }));
import handler from '../../api/webhook';
import bot from '../bot';
import { waitUntil } from '@vercel/functions';

const response = () => { const r: any = { status: jest.fn(), send: jest.fn(), end: jest.fn() }; r.status.mockReturnValue(r); return r; };
beforeEach(() => { jest.clearAllMocks(); delete process.env.WEBHOOK_SECRET; });
it('acknowledges a valid update before its background processing completes', async () => {
  let resolve!: () => void; const work = new Promise<void>(done => { resolve = done; });
  jest.mocked(bot.handleUpdate).mockReturnValue(work);
  const res = response(); await handler({ method: 'POST', query: {}, body: { update_id: 1 } } as any, res);
  expect(res.status).toHaveBeenCalledWith(200); expect(waitUntil).toHaveBeenCalledTimes(1);
  resolve(); await work;
});
it('checks the webhook secret before processing', async () => {
  process.env.WEBHOOK_SECRET = 'test-secret'; const res = response();
  await handler({ method: 'POST', query: { secret: 'wrong' }, body: { update_id: 1 } } as any, res);
  expect(res.status).toHaveBeenCalledWith(403); expect(bot.handleUpdate).not.toHaveBeenCalled(); delete process.env.WEBHOOK_SECRET;
});
it.each(['bad-json', '{}', '{"update_id":"x"}'])('rejects malformed updates: %s', async body => {
  const res = response(); await handler({ method: 'POST', query: {}, body } as any, res);
  expect(res.status).toHaveBeenCalledWith(400); expect(bot.handleUpdate).not.toHaveBeenCalled();
});
it('accepts a health check without scheduling work', async () => {
  const res = response(); await handler({ method: 'GET' } as any, res);
  expect(res.status).toHaveBeenCalledWith(200); expect(waitUntil).not.toHaveBeenCalled();
});
