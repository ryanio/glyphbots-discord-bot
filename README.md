# glyphbots-discord-bot

An AI-enabled Discord bot for the GlyphBots community featuring automated storytelling based on minted artifacts.

## Features

- 📖 **Lore Channel** - Automated AI-generated stories based on GlyphBots artifacts
- 🎲 **Weighted Selection** - Favors recently minted artifacts for fresh content
- 🤖 **AI-Powered** - Uses OpenRouter for flexible model selection (Claude, GPT, etc.)
- ⏱️ **Configurable Intervals** - Customize posting frequency via environment
- 🛡️ **Type-Safe** - Full TypeScript implementation

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Environment Variables](#environment-variables)
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
- OpenRouter API key ([get one here](https://openrouter.ai/keys))

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
LORE_CHANNEL_ID=your_channel_id
OPENROUTER_API_KEY=your_openrouter_api_key

# Optional
LORE_INTERVAL_MINUTES=30
OPENROUTER_MODEL=anthropic/claude-sonnet-4
GLYPHBOTS_API_URL=https://glyphbots.com
STATE_DIR=.state
LOG_LEVEL=info
```

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DISCORD_TOKEN` | Discord bot token | Get from [Discord Developer Portal](https://discord.com/developers/applications) |
| `LORE_CHANNEL_ID` | Channel ID for lore posts | `1234567890123456789` |
| `OPENROUTER_API_KEY` | OpenRouter API key | Get from [OpenRouter](https://openrouter.ai/keys) |

### Discord Setup

1. [Create a Discord application](https://discord.com/developers/applications)
2. Go to the **Bot** tab and click "Add Bot"
3. Copy the bot token to `DISCORD_TOKEN`
4. **Invite bot to your server:**
   - Go to **OAuth2** → **URL Generator**
   - Under **Scopes**, select `bot`
   - Under **Bot Permissions**, select `Send Messages` and `Embed Links`
   - Copy the generated URL and open it in your browser
   - Select your server and authorize

**Quick Invite URL** (replace `YOUR_CLIENT_ID`):
```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=18432&scope=bot
```

### Optional Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `LORE_INTERVAL_MINUTES` | Minutes between lore posts | `30` |
| `OPENROUTER_MODEL` | AI model for story generation | `anthropic/claude-sonnet-4` |
| `GLYPHBOTS_API_URL` | GlyphBots API base URL | `https://glyphbots.com` |
| `STATE_DIR` | Directory for state persistence | `.state` |
| `LOG_LEVEL` | Log verbosity | `info` |

### Supported AI Models

Any model available on [OpenRouter](https://openrouter.ai/models) can be used. Popular options:

| Model | Value |
|-------|-------|
| Claude Sonnet 4 | `anthropic/claude-sonnet-4` |
| Claude 3.5 Sonnet | `anthropic/claude-3.5-sonnet` |
| GPT-4o | `openai/gpt-4o` |
| GPT-4o Mini | `openai/gpt-4o-mini` |
| Llama 3.1 70B | `meta-llama/llama-3.1-70b-instruct` |

## Usage

```bash
# Start the bot
yarn start

# Development mode (with hot reload)
yarn start:dev
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
├── channels/
│   └── lore.ts           # Lore channel handler
├── api/
│   ├── glyphbots.ts      # GlyphBots API client
│   └── openrouter.ts     # OpenRouter AI client
└── lib/
    ├── logger.ts         # Logging utilities
    ├── state.ts          # State persistence
    ├── types.ts          # TypeScript type definitions
    └── utils.ts          # General utilities
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

## Deployment

### Recommended: DigitalOcean

**DigitalOcean Setup ($5/month Basic Droplet):**

1. Create Ubuntu droplet
2. Install Node.js 22 and Yarn
3. Clone repository and install dependencies
4. Install PM2 for process management
5. Configure environment variables
6. Start with PM2

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
- Verify Discord bot has `Send Messages` and `Embed Links` permissions
- Check that bot is added to the lore channel
- Ensure `DISCORD_TOKEN` is correct

**AI generation failing:**
- Verify `OPENROUTER_API_KEY` is valid
- Check OpenRouter account has credits
- Try a different model if current one is unavailable

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

