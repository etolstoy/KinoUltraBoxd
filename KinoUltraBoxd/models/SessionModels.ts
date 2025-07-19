// SessionModels.ts
// -----------------------------------------------------------------------------
// These lightweight interfaces capture **runtime session data** that the bot
// needs to persist between Telegram updates.  Their instances are serialised to
// a key-value store (in-memory during local development, Redis on Vercel) so
// that the stateless webhook runtime can resume a user’s workflow at any step.
// -----------------------------------------------------------------------------
//   • FileQueue       – uploads waiting to be processed with the `go` command.
//   • SelectionState  – interactive TMDB disambiguation in progress.
//   • BotSessionState – top-level container saved under the user’s Telegram id.
// -----------------------------------------------------------------------------

import type { FilmData } from './FilmData';

/**
 * Tracks the raw HTML files a user has uploaded but has not yet processed.
 * The parallel arrays maintain the order in which files were received.
 *
 * Stored under `BotSessionState.fileQueue`.
 */
export interface FileQueue {
  /** Telegram file identifiers for downloading the content later */
  file_ids: string[];
  /** Original filenames to show in progress messages */
  file_names: string[];
}

/**
 * Keeps state of the **manual match selection** wizard that is launched when
 * a film gets multiple potential TMDB matches.  All data is local to a single
 * user and is cleared automatically once the user finishes selecting.
 *
 * Stored under `BotSessionState.selection`.
 */
export interface SelectionState {
  /**
   * Complete list of films returned by `processFilms(html[])`.  Each element
   * may already contain `potentialMatches` produced by TMDB search.
   */
  films: FilmData[];
  /** Indexes (into `films`) that still require user disambiguation */
  selectionQueue: number[];
  /** Cursor within `selectionQueue` that points to the current film */
  currentIdx: number;
  /** Telegram message ids of the poster(s) sent for the current film – used for cleanup */
  posterMessageIds?: number[];
}

/**
 * Single object persisted per Telegram user (keyed by their numeric `id`).
 *
 * The bot loads it at the beginning of each update and writes it back after
 * mutating – this way the workflow survives cold-starts and horizontal scale-out.
 */
export interface BotSessionState {
  /** Files awaiting processing via the `go` command */
  fileQueue: FileQueue;
  /** Defined only when the manual-selection wizard is active */
  selection?: SelectionState;
  /** Optional Kinopoisk.dev API token supplied by the user */
  kinopoiskToken?: string;
  /** Indicates that the bot is waiting for the user to send their Kinopoisk token */
  awaitingKinopoiskToken?: boolean;
  /** Telegram message id of the temporary status message shown during processing */
  tempStatusMessageId?: number;
} 