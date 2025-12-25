# glyphbots-discord-bot

An AI-enabled Discord bot for the GlyphBots community featuring automated storytelling, interactive arena battles, and community playground content.

## Features

- 📖 **Lore Channel** - Automated AI-generated stories based on GlyphBots artifacts
- ⚔️ **Arena Battles** - Interactive PvP battles between GlyphBots with spectator mechanics
- 🎮 **Playground** - Community showcase with bot spotlights, world postcards, and arena recaps
- 🎯 **User-Triggered Content** - Users can request new playground posts with rate-limited action buttons
- 🎨 **16 Narrative Styles** - Rotating styles for variety (cinematic, transmission, first-person, poetic, log entries, memory, myth, noir, broadcast, journal, prophecy, technical, dialogue, archive, testimony, dream)
- 🖼️ **AI Image Generation** - 2K images for epic moments (victories, critical hits, spotlights)
- 🎲 **Weighted Selection** - Favors recently minted artifacts for fresh content
- 🤖 **Google AI Integration** - Uses Gemini models for text and image generation

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Environment Variables](#environment-variables)
- [Arena Battles](#arena-battles)
- [Playground Channel](#playground-channel)
- [Slash Commands](#slash-commands)
- [Usage](#usage)
- [Development](#development)
- [Testing](#testing)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

## Prerequisites

- Node.js 18+
- Yarn package manager
- Discord bot token
- Google AI API key ([get one here](https://aistudio.google.com/app/apikey))

## Installation

```bash
# Clone the repository
git clone https://github.com/ryanio/glyphbots-discord-bot.git
cd glyphbots-discord-bot

# Install dependencies
yarn install

# Build the project
yarn build
```

## Configuration

Create a `.env` file in the root directory with your configuration:

```env
# Required
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_client_id
LORE_CHANNEL_ID=your_lore_channel_id
GOOGLE_AI_API_KEY=your_google_ai_api_key

# Optional - Channel IDs
ARENA_CHANNEL_ID=your_arena_channel_id
PLAYGROUND_CHANNEL_ID=your_playground_channel_id

# Optional - Intervals (in minutes)
LORE_MIN_INTERVAL_MINUTES=240
LORE_MAX_INTERVAL_MINUTES=720
PLAYGROUND_MIN_INTERVAL_MINUTES=240
PLAYGROUND_MAX_INTERVAL_MINUTES=720

# Optional - Arena Settings
ARENA_CHALLENGE_TIMEOUT_SECONDS=120
ARENA_ROUND_TIMEOUT_SECONDS=30
ARENA_MAX_ROUNDS=5

# Optional - Other
GLYPHBOTS_API_URL=https://glyphbots.com
STATE_DIR=.state
LOG_LEVEL=info
```

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DISCORD_TOKEN` | Discord bot token | Get from [Discord Developer Portal](https://discord.com/developers/applications) |
| `DISCORD_CLIENT_ID` | Discord application client ID | Get from [Discord Developer Portal](https://discord.com/developers/applications) |
| `LORE_CHANNEL_ID` | Channel ID for lore posts | `1234567890123456789` |
| `GOOGLE_AI_API_KEY` | Google AI API key | Get from [Google AI Studio](https://aistudio.google.com/app/apikey) |

### Discord Setup

1. [Create a Discord application](https://discord.com/developers/applications)
2. Go to the **Bot** tab and click "Add Bot"
3. Copy the bot token to `DISCORD_TOKEN`
4. Copy the application ID to `DISCORD_CLIENT_ID`
5. **Invite bot to your server:**
   - Go to **OAuth2** → **URL Generator**
   - Under **Scopes**, select `bot` and `applications.commands`
   - Under **Bot Permissions**, select:
     - Send Messages
     - Embed Links
     - Use Slash Commands
     - Create Public Threads
     - Send Messages in Threads
     - Manage Threads
   - Copy the generated URL and open it in your browser
   - Select your server and authorize

**Quick Invite URL** (replace `YOUR_CLIENT_ID`):
```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=326417591360&scope=bot%20applications.commands
```

### Optional Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `LORE_MIN_INTERVAL_MINUTES` | Minimum minutes between lore posts | `240` (4 hours) |
| `LORE_MAX_INTERVAL_MINUTES` | Maximum minutes between lore posts | `720` (12 hours) |
| `PLAYGROUND_MIN_INTERVAL_MINUTES` | Minimum minutes between playground posts | `240` (4 hours) |
| `PLAYGROUND_MAX_INTERVAL_MINUTES` | Maximum minutes between playground posts | `720` (12 hours) |
| `ARENA_CHALLENGE_TIMEOUT_SECONDS` | Challenge acceptance timeout | `120` |
| `ARENA_ROUND_TIMEOUT_SECONDS` | Round action timeout | `30` |
| `ARENA_MAX_ROUNDS` | Maximum rounds per battle | `5` |
| `GLYPHBOTS_API_URL` | GlyphBots API base URL | `https://glyphbots.com` |
| `STATE_DIR` | Directory for state persistence | `.state` |
| `LOG_LEVEL` | Log verbosity | `info` |

## Arena Battles

The Arena channel features interactive PvP battles between GlyphBots with strategic gameplay and spectator participation.

### Battle Flow

1. **Challenge Phase** - A player challenges with `/arena challenge bot:<id>`
2. **Pre-Battle** - Opponent accepts and both fighters choose opening stance
3. **Combat Rounds** - 3-5 rounds where fighters select abilities
4. **Victory** - Winner declared with AI-generated narrative

### Spectator Mechanics

Spectators can influence battles through crowd actions:

- **🔴 Cheer Red** - +5% damage to red fighter next round
- **🔵 Cheer Blue** - +5% damage to blue fighter next round
- **💀 Bloodlust** - Both fighters get +10% damage, -10% defense
- **⚡ Surge** - +15 crowd energy

### Arena Events

When crowd energy reaches 100%, random arena events trigger:

- **Power Surge** - Random fighter gains +20% all stats for 2 rounds
- **Chaos Field** - Both fighters get random bonus effects
- **Arena Hazard** - Environmental damage to both (favors higher endurance)

### Thread-Based Battles

Each battle runs in its own public thread to keep the main channel clean. Threads auto-archive after 24 hours of inactivity.

## Playground Channel

The Playground channel features rotating community content with user-triggered posts.

### Content Types

- **🌟 Bot Spotlights** - Featured bots with full stats, powers, and lore
- **🌍 World Postcards** - Atmospheric descriptions of world artifacts
- **🎒 Item Discovery** - Newly minted items with AI-generated lore
- **📰 Arena Recaps** - Daily battle summaries and leaderboards
- **🎲 Random Encounters** - "What if?" scenarios featuring random bots
- **❓ Help Content** - Tips, guides, and command references

### User Actions

Users can request new content by clicking **Request** buttons on any playground post:

- **Request Spotlight** - Trigger a new bot spotlight
- **Request Discovery** - Trigger a new item discovery
- **Request Encounter** - Trigger a new random encounter
- **Request Postcard** - Trigger a new world postcard
- **Request Recap** - Trigger a new arena recap
- **Request Help** - Trigger new help content

**Rate Limits:** Each user can request each content type **once per 6 hours**. This prevents spam while allowing active community engagement.

### Automatic Posting

The bot automatically posts new content at random intervals (default: 4-12 hours). User requests supplement this with on-demand content.

## Slash Commands

### Global Commands

| Command | Description |
|---------|-------------|
| `/help [topic]` | Get help with GlyphBots features |
| `/info bot id:<number>` | Look up a specific bot |
| `/info artifact id:<number>` | Look up a specific artifact |
| `/info stats` | Bot statistics and uptime |
| `/tips` | Show a random helpful tip |

### Arena Commands

| Command | Description |
|---------|-------------|
| `/arena challenge bot:<id>` | Start a challenge with your bot |
| `/arena stats [user]` | View arena battle record |
| `/arena leaderboard` | Top fighters this season |
| `/arena history` | Recent battle results |

### Playground Commands

| Command | Description |
|---------|-------------|
| `/spotlight` | Show current featured bot |
| `/random bot` | Get a random bot spotlight |
| `/random artifact` | Get a random artifact showcase |
| `/random world` | Get a random world postcard |
| `/help playground` | Get help about playground features and user actions |

### Stats Commands

| Command | Description |
|---------|-------------|
| `/stats me` | Your personal stats overview |
| `/stats arena [user]` | Arena battle record |
| `/stats server` | Server-wide activity stats |
| `/stats bot id:<number>` | Combat stats for a specific bot |

## Usage

```bash
# Start the bot
yarn start

# Development mode (with hot reload)
yarn start:dev

# Deploy slash commands
yarn commands:deploy
```

## Development

### Setup Development Environment

```bash
# Install dependencies
yarn install

# Run in development mode
yarn start:dev

# Build the project
yarn build

# Format code
yarn format

# Lint code
yarn lint
```

### Project Structure

```
src/
├── index.ts              # Main entry point
├── api/
│   ├── glyphbots.ts      # GlyphBots API client
│   └── google-ai.ts      # Google AI client (text + image)
├── channels/
│   ├── lore.ts           # Lore channel handler
│   ├── arena.ts          # Arena channel handler
│   └── playground.ts     # Playground channel handler
├── commands/
│   ├── index.ts          # Command definitions
│   ├── deploy.ts         # Command deployment
│   ├── help.ts           # /help handler
│   ├── info.ts           # /info handler
│   ├── arena.ts          # /arena handler
│   ├── spotlight.ts      # /spotlight handler
│   ├── random.ts         # /random handler
│   ├── stats.ts          # /stats handler
│   └── tips.ts           # /tips handler
├── arena/
│   ├── state.ts          # Battle state machine
│   ├── combat.ts         # Combat resolution
│   ├── interactions.ts   # Button/menu handlers
│   ├── spectators.ts     # Spectator mechanics
│   ├── threads.ts        # Thread management
│   ├── narrative.ts      # AI battle narration
│   └── prompts.ts        # Battle prompts
├── playground/
│   ├── rotation.ts       # Content rotation
│   ├── spotlight.ts      # Bot spotlight
│   ├── postcard.ts       # World postcard
│   ├── discovery.ts      # Item discovery
│   ├── encounter.ts      # Random encounters
│   ├── recap.ts          # Arena recap
│   ├── interactions.ts   # Button interaction handlers
│   └── rate-limit.ts     # User action rate limiting
├── lore/
│   ├── generate.ts       # Lore generation
│   └── prompts.ts        # Narrative styles
├── help/
│   ├── embeds.ts         # Help embeds
│   └── scheduler.ts      # Help posting
└── lib/
    ├── logger.ts         # Logging utilities
    ├── state.ts          # State persistence
    ├── types.ts          # TypeScript types
    ├── utils.ts          # General utilities
    └── constants.ts      # Application constants
```

## Testing

```bash
# Run all tests
yarn test

# Run tests with coverage
yarn test:coverage

# Run tests in CI mode
yarn test:ci
```

### Test Coverage Goals

- Arena combat logic: 90%+
- Arena state management: 85%+
- Spectator actions: 80%+
- API clients: 80%+

## Deployment

### Recommended: DigitalOcean

**DigitalOcean Setup ($5/month Basic Droplet):**

1. Create Ubuntu droplet
2. Install Node.js 22 and Yarn
3. Clone repository and install dependencies
4. Install PM2 for process management
5. Configure environment variables
6. Deploy slash commands: `yarn commands:deploy`
7. Start with PM2

```bash
# Install PM2 globally
yarn global add pm2

# Start the bot
pm2 start yarn -- start

# Monitor the bot
pm2 list
pm2 logs

# Install log rotation
pm2 install pm2-logrotate

# Auto-start on reboot
pm2 startup
pm2 save
```

### Alternative: Docker

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build
CMD ["yarn", "start"]
```

## Troubleshooting

### Common Issues

**Bot not posting messages:**
- Verify Discord bot has required permissions
- Check that bot is added to the channels
- Ensure `DISCORD_TOKEN` is correct

**AI generation failing:**
- Verify `GOOGLE_AI_API_KEY` is valid
- Check Google AI account has credits/quota
- Check API key has proper permissions

**Slash commands not appearing:**
- Run `yarn commands:deploy` to register commands
- Wait up to 1 hour for global command propagation
- Use `--guild` flag for instant guild-only commands

**No artifacts being selected:**
- Ensure GlyphBots API is accessible
- Check `GLYPHBOTS_API_URL` is correct

### Debug Mode

Enable debug logging to troubleshoot issues:

```bash
LOG_LEVEL=debug yarn start
```

### Logs

The bot provides structured logging with different levels:
- `debug`: Detailed information for debugging
- `info`: General information about bot activity
- `warn`: Warning messages for potential issues
- `error`: Error messages for failures

## Contributing

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Run tests: `yarn test`
5. Format code: `yarn format`
6. Commit changes: `git commit -m 'Add amazing feature'`
7. Push to branch: `git push origin feature/amazing-feature`
8. Open a Pull Request

### Code Standards

- Follow TypeScript best practices
- Write tests for new features
- Use `yarn format` before committing
- Follow the existing code structure
- Add JSDoc comments for public APIs

---

Built for the [GlyphBots](https://glyphbots.com) community.
