import { createSessionStore } from '../sessionStore';
import { BotSessionState } from '../models/SessionModels';
import { randomUUID } from 'crypto';

/**
 * Thin wrapper around the key-value store that provides strongly-typed helpers
 * to load and persist a user’s session.  Keeps `bot.ts` free of storage details.
 */
export class SessionManager {
  private readonly store = createSessionStore<BotSessionState>();

  /** Retrieve session or return a blank default object. */
  async get(userId: number): Promise<BotSessionState> {
    const existing = await this.store.get(userId.toString());
    // Read only current fields; discard obsolete queues and credentials in stored sessions.
    return Number.isSafeInteger(existing?.lastProfileUpdateId)
      ? { lastProfileUpdateId: existing!.lastProfileUpdateId }
      : {};
  }

  /** Persist full session object (overwrites previous value). */
  async set(userId: number, state: BotSessionState): Promise<void> {
    await this.store.set(userId.toString(), state);
  }

  async acquireImport(userId: number): Promise<string | null> {
    const token = randomUUID();
    return await this.store.acquire(`profile-import:${userId}`, token, 360) ? token : null;
  }

  async releaseImport(userId: number, token: string): Promise<void> {
    await this.store.release(`profile-import:${userId}`, token);
  }
}

// Shared singleton instance
export const sessionManager = new SessionManager();
