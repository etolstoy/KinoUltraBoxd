# KinoUltraBoxd

A Telegram bot that helps users export their movie ratings from Kinopoisk (Russian movie database) to Letterboxd format. Send a public Kinopoisk profile URL, numeric ID, or unique profile alias. The bot retrieves ratings and watched markers anonymously, creates a Letterboxd CSV, and sends a complete JSON backup.

You can either deploy your own bot, or use the hosted version: [@KinoBoxdBot](https://t.me/KinoBoxdBot).

## Project Purpose

KinoUltraBoxd automates the migration of movie ratings from Kinopoisk to Letterboxd by:
- Fetching public profiles through the official Android client's GraphQL query, with a website-query fallback
- Checking pagination totals and rejecting incomplete or changing libraries
- Preserving personal ratings, watched markers, and source timestamps
- Matching movies across multiple databases (IMDB, TMDB, WikiData)
- Exporting confident matches automatically and listing unresolved entries separately
- Generating CSV files ready for Letterboxd import
- Providing detailed statistics about the conversion process

## Technology Stack

### Core Technologies
- **Node.js** with **TypeScript** - Main runtime and language
- **Telegraf** - Telegram Bot Framework for handling user interactions
- **Better SQLite3** - Local database for IMDB data caching
- **Axios** - HTTP client for API requests

### External APIs
- **TMDB API** - Movie database for title matching
- **WikiData API** - Additional movie metadata source
- **Kinopoisk Dev API** - Unofficial Kinopoisk API for enhanced matching
- **IMDB Dataset** - Local SQLite database for movie lookups

### Development Tools
- **Jest** - Testing framework
- **ts-jest** - TypeScript support for Jest
- **ESLint** & **TypeScript compiler** - Code quality and type checking

## Architecture and Dependencies

### Project Structure
```
KinoUltraBoxd/
├── bot.ts                          # Main bot entry point
├── models/
│   ├── FilmData.ts                 # Core data models
│   └── SessionModels.ts            # Bot session state models
├── services/
│   ├── filmProcessingService.ts    # Main film processing pipeline
│   ├── kinopoiskProfileService.ts  # Anonymous paginated profile retrieval
│   ├── kinopoiskQueries.ts         # Official-client GraphQL documents
│   ├── localImdbService.ts         # Local IMDB database operations
│   ├── tmdbSearchService.ts        # TMDB API integration
│   ├── kinopoiskDevService.ts      # Kinopoisk API integration
│   ├── wikiDataService.ts          # WikiData API integration
│   ├── letterboxdExportService.ts  # CSV generation for Letterboxd
│   ├── statsReportService.ts       # Export statistics generation
│   └── sessionManager.ts           # User session persistence
├── profileImportHandler.ts         # Automatic Telegram import flow
└── sessionStore.ts                 # Session storage implementation
api/
└── webhook.ts                      # Vercel webhook handler
tests/
├── kinopoiskProfileService.test.ts # Profile import and failure handling tests
└── localImdbService.test.ts        # IMDB service tests
```

### Key Dependencies
- `telegraf` - Telegram bot framework
- `better-sqlite3` - SQLite database for IMDB data
- `axios` - HTTP client for API requests
- `ioredis` - Redis client for session storage
- `dotenv` - Environment variable management

### Processing Pipeline
1. **Profile retrieval** - Parse a profile link/ID/alias and fetch all reactions from GraphQL
2. **Local IMDB Lookup** - Match against local IMDB database
3. **WikiData Enrichment** - Get additional metadata from WikiData
4. **TMDB Search** - Search TMDB API for missing movies
5. **Kinopoisk API** - Use unofficial API as fallback
6. **Match resolution** - Accept unique exact title/year matches; report unresolved entries without blocking profile imports
7. **CSV Export** - Generate Letterboxd-compatible CSV file

## How to Test Locally and Deploy

### Prerequisites
- Node.js 20+ (Node 22 recommended)
- npm or yarn
- Telegram Bot Token (from [@BotFather](https://t.me/botfather))
- Optional: Kinopoisk Dev API token (from [@poiskkinodev_bot](https://t.me/kinopoiskdev_bot))

### Local Development

1. **Clone and install dependencies:**
```bash
git clone <repository-url>
cd KinoUltraBoxd
npm install
```

2. **Environment setup:**
Create a `.env` file in the root directory:
```env
BOT_TOKEN=your_telegram_bot_token_here
TMDB_API_KEY=optional_tmdb_read_access_token
# Optional metadata fallback, owned by the operator; never requested from users:
KINOPOISK_API_KEY=optional_kinopoisk_dev_key
# Use a Redis protocol URL for persistent sessions and atomic import locks on Vercel:
REDIS_URL=rediss://user:password@host:port
```

3. **Run tests:**
```bash
npm test
```

4. **Type checking:**
```bash
npm run typecheck
```

5. **Start development server:**
```bash
npm run dev
```

### Production Deployment (Vercel)

1. **Deploy to Vercel:**
```bash
npm install -g vercel
vercel
```

2. **Configure environment variables in Vercel:**
- `BOT_TOKEN` - Your Telegram bot token
- `TMDB_API_KEY` - TMDB token

3. **Set up Telegram webhook:**
```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://your-vercel-app.vercel.app/api/webhook?secret=<WEBHOOK_SECRET>"}'
```

### Build Commands
- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run production build
- `npm run dev` - Development mode with hot reload
- `npm test` - Run test suite
- `npm run typecheck` - TypeScript type checking

### Usage Instructions

1. Send `/start` or paste `https://www.kinopoisk.ru/user/<id>/` directly into the bot.
2. The bot fetches all accessible rated and watched entries. No Kinopoisk login, developer token, file uploads, or second start action is required.
3. Download `letterboxd.csv` and import it at https://letterboxd.com/import/. Select the option to mark imported films as watched.
4. Keep `kinopoisk-backup.json`, which contains every retrieved record, including series and unmatched films. `not_found_films.txt` lists entries omitted from the CSV.

A display name is not a unique account identifier. Use the profile URL, numeric ID, or a unique profile alias supported by Kinopoisk. Private/unavailable profiles need their visibility changed by the account owner. The bot’s `/help` and unavailable-profile message explain the website path: avatar → «Мой профиль» → pencil icon → «Кто может видеть ваш профиль?» → allow access to everyone. As an optional check, open the profile’s «Оценки и просмотры» in a private browser window without signing in; seeing titles and personal scores confirms anonymous visibility. A login prompt or CAPTCHA alone does not establish that a profile is private. The settings path follows [Kinopoisk’s official help](https://yandex.ru/support/kinopoisk/ru/encyclopedia/profile).

Source `votedAt` and watched-marker `updatedAt` values are preserved separately in the backup. They are not reliable diary viewing dates, so the profile importer leaves `WatchedDate` blank. Ratings use Letterboxd's `Rating10` column without rescaling. Series are kept in the backup and omitted from the movie CSV.

### Import reliability and hosting

- The Vercel static output directory is `public/`, containing only `robots.txt`. The bot is served by the `/api/webhook` function; compiled application files in `dist/` are not published as static assets.
- The importer uses the exact Android 7.107.4 query document extracted on 2026-11-07. Query provenance is recorded in `kinopoiskQueries.ts`. Kinopoisk can change or remove undocumented operations; the website query is used if the Android operation is no longer allowlisted.
- Pages contain at most 20 records. The importer checks the advertised total, offsets, unique IDs, reaction values, and final page; incomplete or changing libraries fail explicitly. HTTP 429, server failures, and network errors have bounded retries. No partial profile is presented as complete.
- The Vercel webhook acknowledges Telegram immediately and retains processing with `waitUntil`. Its configured maximum duration is 300 seconds; profile fetching has a 240-second budget and metadata matching ends before the overall 270-second processing budget. Unmatched entries remain in the backup. Profiles that cannot be fetched within the budget report a timeout and need a longer-running worker.
- Use `REDIS_URL` (`redis://` or `rediss://`, not an Upstash REST endpoint) on Vercel for persistent update deduplication and atomic per-user import locks across instances. Local development uses an in-memory store.
- Configure the existing `WEBHOOK_SECRET` for the webhook URL. Deployment requires a Vercel runtime/plan that supports the requested duration. This change does not deploy the bot or change its webhook automatically.

### Reproducing the acceptance checks

```bash
npm test -- --runInBand
npm run typecheck
npm run build
npm run verify:profiles
# An additional public profile with over 1500 entries at verification time:
PROFILE_EVIDENCE_DIR=artifacts/profile-import-large npm run verify:profiles -- 2316547
# Run the actual bot middleware for a larger profile, saving outgoing files locally:
PROFILE_EVIDENCE_DIR=artifacts/profile-import-bot npm run verify:profiles -- --bot-only 2425315
```

The opt-in live script retrieves real public profiles, compares every ID and personal rating with the separate website query, runs the real identifier-enrichment/CSV pipeline, and writes CSVs plus `live-results.json` to the evidence directory. It also exercises the production Telegraf message handler with real Kinopoisk/mapping services while intercepting outgoing Telegram deliveries locally; it sends no Telegram messages. Keep artifacts out of version control.

The automated suite covers malformed and unavailable profiles, empty/rated/watched/series libraries, pagination beyond 1500 entries, duplicate and changing pages, fallback, rate limits, retries, deadlines, CSV escaping, conservative matching, event-date preservation, duplicate Telegram updates, overlapping imports, and webhook acknowledgement. Live checks are intentionally separate from the ordinary test suite.
