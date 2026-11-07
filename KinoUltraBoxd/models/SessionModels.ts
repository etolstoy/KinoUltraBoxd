/** State persisted per Telegram user for profile-import deduplication. */
export interface BotSessionState {
  lastProfileUpdateId?: number;
}
