# KinoUltraBoxd

A Telegram bot that helps users export their movie ratings from Kinopoisk (Russian movie database) to Letterboxd format. The bot processes HTML files containing user ratings and creates a CSV file compatible with Letterboxd's import feature.

You can either deploy your own bot, or use the hosted version: [@KinoBoxdBot](https://t.me/KinoBoxdBot).

## Project Purpose

KinoUltraBoxd automates the migration of movie ratings from Kinopoisk to Letterboxd by:
- Parsing HTML files exported from Kinopoisk user rating pages
- Matching movies across multiple databases (IMDB, TMDB, WikiData)
- Handling manual disambiguation for ambiguous matches
- Generating CSV files ready for Letterboxd import
- Providing detailed statistics about the conversion process

## Technology Stack

### Core Technologies
- **Node.js** with **TypeScript** - Main runtime and language
- **Telegraf** - Telegram Bot Framework for handling user interactions
- **Better SQLite3** - Local database for IMDB data caching
- **Cheerio** - HTML parsing for Kinopoisk data extraction
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
│   ├── htmlParsingService.ts       # Kinopoisk HTML parsing
│   ├── localImdbService.ts         # Local IMDB database operations
│   ├── tmdbSearchService.ts        # TMDB API integration
│   ├── kinopoiskDevService.ts      # Kinopoisk API integration
│   ├── wikiDataService.ts          # WikiData API integration
│   ├── letterboxdExportService.ts  # CSV generation for Letterboxd
│   ├── statsReportService.ts       # Export statistics generation
│   ├── telegramFileService.ts      # File handling from Telegram
│   └── sessionManager.ts           # User session persistence
├── manualSelectionHandler.ts       # Interactive movie disambiguation
└── sessionStore.ts                 # Session storage implementation
api/
└── webhook.ts                      # Vercel webhook handler
tests/
├── htmlParsingService.test.ts      # HTML parsing tests
└── localImdbService.test.ts        # IMDB service tests
```

### Key Dependencies
- `telegraf` - Telegram bot framework
- `better-sqlite3` - SQLite database for IMDB data
- `cheerio` - Server-side jQuery for HTML parsing
- `axios` - HTTP client for API requests
- `ioredis` - Redis client for session storage
- `dotenv` - Environment variable management

### Processing Pipeline
1. **HTML Parsing** - Extract movie data from Kinopoisk HTML files
2. **Local IMDB Lookup** - Match against local IMDB database
3. **WikiData Enrichment** - Get additional metadata from WikiData
4. **TMDB Search** - Search TMDB API for missing movies
5. **Kinopoisk API** - Use unofficial API as fallback
6. **Manual Disambiguation** - Interactive selection for ambiguous matches
7. **CSV Export** - Generate Letterboxd-compatible CSV file

## How to Test Locally and Deploy

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Telegram Bot Token (from [@BotFather](https://t.me/botfather))
- Optional: Kinopoisk Dev API token (from [@kinopoiskdev_bot](https://t.me/kinopoiskdev_bot))

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
TMDB_API_KEY=tmdb_token
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
1. Start the bot with `/start`
2. Follow the `/help` command instructions to export HTML files from Kinopoisk
3. Upload HTML files to the bot
4. Click "✅ Начать экспорт" to begin processing
5. If prompted, provide a Kinopoisk Dev API token
6. Manually disambiguate any unclear movie matches
7. Download the generated `letterboxd.csv` file
8. Import the CSV to Letterboxd

The bot supports both rated and watched (but unrated) movies, handles pagination across multiple HTML files, and provides detailed statistics about the conversion process.
