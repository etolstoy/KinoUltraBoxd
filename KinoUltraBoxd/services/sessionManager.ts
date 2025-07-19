import { createSessionStore } from '../sessionStore';
import { BotSessionState } from '../models/SessionModels';

/**
 * Thin wrapper around the key-value store that provides strongly-typed helpers
 * to load and persist a user’s session.  Keeps `bot.ts` free of storage details.
 */
export class SessionManager {
  private readonly store = createSessionStore<BotSessionState>();

  /** Retrieve session or return a blank default object. */
  async get(userId: number): Promise<BotSessionState> {
    const existing = await this.store.get(userId.toString());
    return (
      existing ?? {
        fileQueue: { file_ids: [], file_names: [] },
      }
    );
  }

  /** Persist full session object (overwrites previous value). */
  async set(userId: number, state: BotSessionState): Promise<void> {
    await this.store.set(userId.toString(), state);
  }

  /** Convenience: clear selection workflow (if exists). */
  async clearSelection(userId: number): Promise<void> {
    const state = await this.get(userId);
    delete state.selection;
    await this.set(userId, state);
  }
}

// Shared singleton instance
export const sessionManager = new SessionManager(); 