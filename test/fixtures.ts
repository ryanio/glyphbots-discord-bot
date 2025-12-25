import type { Client } from "discord.js";
import { mockDeep, mockReset } from "jest-mock-extended";
import type {
  Artifact,
  ArtifactsListResponse,
  ArtifactsSummaryResponse,
  Bot,
  BotStory,
  Config,
  GeneratedLore,
  LoreContext,
} from "../src/lib/types";

// ============================================================================
// Real Data from GlyphBots API (December 2024)
// ============================================================================

/**
 * Real artifact from GlyphBots API - Binarywire's Stealth Infiltration
 */
export const REAL_ARTIFACT: Artifact = {
  id: "487391b9-d01a-477a-aad5-668537899769",
  botTokenId: 2369,
  title: "Stealth Infiltration Specialist",
  durationMs: 21_392,
  createdAt: "2025-12-04T20:49:40.978Z",
  mintedAt: "2025-12-04T20:50:27.893Z",
  imageUrl:
    "https://sbb5m1zk7m16e5xt.public.blob.vercel-storage.com/artifacts/2369/1764881380731.jpg",
  contractTokenId: 137,
  mintQuantity: 2,
  minter: "0x4A301A07e220BF6663D965bb1B4E80AB87508734",
};

/**
 * Second real artifact from GlyphBots API
 */
export const REAL_ARTIFACT_2: Artifact = {
  id: "07b49e5c-6d44-4cfb-b65b-4263447fb2a0",
  botTokenId: 4791,
  title: "The Sacred Crystal Harbor Defense",
  durationMs: 28_834,
  createdAt: "2025-12-03T23:26:27.833Z",
  mintedAt: "2025-12-03T23:27:04.067Z",
  imageUrl:
    "https://sbb5m1zk7m16e5xt.public.blob.vercel-storage.com/artifacts/4791/1764804387676.png",
  contractTokenId: 136,
  mintQuantity: 1,
  minter: "0x00A839dE7922491683f547a67795204763ff8237",
};

/**
 * Real bot data from GlyphBots API - Binarywire #2369
 */
export const REAL_BOT: Bot = {
  id: "bot-2369",
  name: "Binarywire",
  tokenId: 2369,
  traits: [
    { trait_type: "Name", value: "Binarywire" },
    { trait_type: "Head", value: "╭───╮" },
    { trait_type: "Eyes", value: "◇ ◇" },
    { trait_type: "Mouth", value: "┬" },
    { trait_type: "Arms", value: "├" },
    { trait_type: "Body", value: "▧" },
    { trait_type: "Legs", value: "◈" },
    { trait_type: "Hat", value: "None" },
    { trait_type: "Glasses", value: "None" },
    { trait_type: "Backpack", value: "None" },
    { trait_type: "Weapon", value: "None" },
    { trait_type: "Antenna", value: "Yes" },
    { trait_type: "Chest Light", value: "No" },
    { trait_type: "Treads", value: "No" },
    { trait_type: "Theme", value: "Monochrome" },
  ],
  rarityRank: 6250,
  unicode: {
    unicode: ["╭", "─", "╮", "^", "├", "◇", "▧", "◈"],
    textContent: ["╭───╮ ^", "├ ◇ ◇ ├", "▧", "◈"],
    colors: { background: "#000000", text: "#ffffff" },
  },
  burnedAt: null,
  burnedBy: null,
};

/**
 * Real bot story from GlyphBots API - Binarywire #2369
 */
export const REAL_BOT_STORY: BotStory = {
  arc: {
    id: "shadow_stalker",
    title: "Stealth Infiltration Specialist",
    role: "Security Bypass Expert",
    faction: "Void Syndicate",
    mission: {
      type: "infiltration",
      objective: "Bypass 8 security scanners to reach central data vault",
      setting: "High-security corporate sector, Black Site 7",
      threat: "Patrol algorithms sweeping for intruders every 5 seconds",
      mechanic: "Move through shadow zones, avoid detection grids",
      timeContext: "90 seconds before vault access expires",
      stakesSuccess: "Vault reached, critical data extracted",
      stakesFailure: "Detected and locked out, mission fails",
    },
    abilities: [
      {
        name: "Shadow Merge",
        effect: "Become invisible in dark zones",
        cooldown: "6 seconds",
        resource: "",
      },
      {
        name: "Patrol Hack",
        effect: "Freeze one security scanner for 8 seconds",
        cooldown: "20 seconds",
        resource: "",
      },
      {
        name: "Void Step",
        effect: "Teleport through one security barrier",
        cooldown: "",
        resource: "2 charges",
      },
    ],
    symbolBias: ["■", "⟈", "※"],
    environmentObjects: [
      "void rifts",
      "shadow zones",
      "stealth corridors",
      "eclipse barriers",
      "null fields",
      "dark matter pools",
      "cloaking nodes",
      "entropy wells",
    ],
    snippet:
      "Eight security scanners stand between you and the vault. Patrol algorithms sweep every 5 seconds. Ninety seconds before access expires. Your Shadow Merge hides you in darkness—but light zones expose you.",
  },
  storySeed: 2_977_619,
  storyPowers: ["Echo Clone", "Time Dilation", "System Scan"],
  storyStats: {
    luck: 55,
    agility: 53,
    charisma: 49,
    strength: 50,
    endurance: 54,
    intellect: 41,
  },
  storySnippet:
    "Binarywire: Dual vision reveals the truth. You stand ready. Eight security scanners stand between you and the vault. Patrol algorithms sweep every 5 seconds. Ninety seconds before access expires. Your Shadow Merge hides you in darkness—but light zones expose you.",
  missionBrief: `=== MISSION BRIEFING ===
Role: Security Bypass Expert
Type: INFILTRATION

Objective: Bypass 8 security scanners to reach central data vault
Location: High-security corporate sector, Black Site 7
Threat: Patrol algorithms sweeping for intruders every 5 seconds
Method: Move through shadow zones, avoid detection grids
Time Constraint: 90 seconds before vault access expires

=== AVAILABLE ABILITIES ===
• Shadow Merge: Become invisible in dark zones (6 seconds cooldown)
• Patrol Hack: Freeze one security scanner for 8 seconds (20 seconds cooldown)
• Void Step: Teleport through one security barrier [2 charges]

=== STAKES ===
Success: Vault reached, critical data extracted
Failure: Detected and locked out, mission fails
`,
};

/**
 * Real artifacts summary from GlyphBots API
 */
export const REAL_ARTIFACTS_SUMMARY: ArtifactsSummaryResponse = {
  total: 137,
  last1d: 4,
  last7d: 7,
  last30d: 53,
};

// ============================================================================
// Minimal Test Fixtures (for quick tests)
// ============================================================================

/**
 * Minimal artifact for quick tests
 */
export const createArtifact = (overrides?: Partial<Artifact>): Artifact => ({
  id: "artifact-1",
  botTokenId: 123,
  imageUrl: "https://example.com/image.png",
  title: "Test Artifact",
  createdAt: "2024-01-01T00:00:00Z",
  mintedAt: "2024-01-02T00:00:00Z",
  contractTokenId: 456,
  mintQuantity: 1,
  minter: "0x1234567890123456789012345678901234567890",
  ...overrides,
});

/**
 * Minimal bot for quick tests
 */
export const createBot = (overrides?: Partial<Bot>): Bot => ({
  id: "bot-123",
  name: "TestBot",
  tokenId: 123,
  traits: [{ trait_type: "Background", value: "Blue" }],
  rarityRank: 500,
  unicode: {
    unicode: ["U+0041"],
    textContent: ["A"],
    colors: { background: "#000", text: "#fff" },
  },
  burnedAt: null,
  burnedBy: null,
  ...overrides,
});

/**
 * Minimal bot story for quick tests
 */
export const createBotStory = (overrides?: Partial<BotStory>): BotStory => ({
  arc: {
    id: "arc-1",
    title: "The Journey",
    role: "Warrior",
    faction: "The Order",
    mission: {
      type: "delivery",
      objective: "Deliver the artifact",
      setting: "Ancient ruins",
      threat: "Guardians",
      mechanic: "Stealth",
      timeContext: "Dawn",
      stakesSuccess: "Save the realm",
      stakesFailure: "Eternal darkness",
    },
    abilities: [],
    symbolBias: [],
    environmentObjects: [],
    snippet: "A warrior...",
  },
  storySeed: 12_345,
  storyPowers: [],
  storyStats: {},
  storySnippet: "Snippet",
  missionBrief: "Mission",
  ...overrides,
});

/**
 * Create a lore context from artifacts, bot, and optional story
 */
export const createLoreContext = (
  overrides?: Partial<LoreContext>
): LoreContext => ({
  artifact: createArtifact(),
  bot: createBot(),
  story: null,
  ...overrides,
});

/**
 * Create generated lore from bot and artifact
 */
export const createGeneratedLore = (
  overrides?: Partial<GeneratedLore>
): GeneratedLore => {
  const bot = overrides?.bot ?? createBot();
  const artifact = overrides?.artifact ?? createArtifact();
  return {
    title: `${bot.name}: ${artifact.title}`,
    narrative: "Generated story narrative...",
    artifact,
    bot,
    ...overrides,
  };
};

// ============================================================================
// API Response Fixtures
// ============================================================================

/**
 * Create artifacts list response
 */
export const createArtifactsListResponse = (
  items: Artifact[] = [createArtifact()],
  nextCursor?: string
): ArtifactsListResponse => ({
  ok: true,
  items,
  nextCursor,
});

/**
 * Create artifacts summary response
 */
export const createArtifactsSummaryResponse = (
  overrides?: Partial<ArtifactsSummaryResponse>
): ArtifactsSummaryResponse => ({
  total: 100,
  last1d: 5,
  last7d: 20,
  last30d: 50,
  ...overrides,
});

// ============================================================================
// Config Fixtures
// ============================================================================

/**
 * Default test configuration
 */
export const TEST_CONFIG: Config = {
  discordToken: "test-token",
  discordClientId: "test-client-id",
  discordGuildId: null,
  loreChannelId: "123456789",
  loreMinIntervalMinutes: 240,
  loreMaxIntervalMinutes: 720,
  arenaChannelId: null,
  arenaChallengeTimeoutSeconds: 120,
  arenaRoundTimeoutSeconds: 60,
  arenaMaxRounds: 10,
  playgroundChannelId: null,
  playgroundMinIntervalMinutes: 240,
  playgroundMaxIntervalMinutes: 720,
  googleAiApiKey: "test-google-ai-key",
  glyphbotsApiUrl: "https://glyphbots.com",
  logLevel: "info",
};

/**
 * Create a config with overrides
 */
export const createConfig = (overrides?: Partial<Config>): Config => ({
  ...TEST_CONFIG,
  ...overrides,
});

// ============================================================================
// Discord Mock Helpers
// ============================================================================

/**
 * Mock type for Discord channel
 */
export type MockChannel = {
  id: string;
  name: string;
  isTextBased: () => boolean;
  isSendable: () => boolean;
  send: jest.Mock;
};

/**
 * Create a mock Discord channel
 */
export const createMockChannel = (
  overrides?: Partial<MockChannel>
): MockChannel => ({
  id: "123456789",
  name: "lore",
  isTextBased: () => true,
  isSendable: () => true,
  send: jest.fn().mockResolvedValue({}),
  ...overrides,
});

/**
 * Create a deeply mocked Discord client
 */
export const createMockClient = () => {
  const client = mockDeep<Client>();
  return client;
};

/**
 * Reset a mocked Discord client
 */
export const resetMockClient = (
  client: ReturnType<typeof mockDeep<Client>>
) => {
  mockReset(client);
};

// ============================================================================
// OpenRouter Mock Helpers
// ============================================================================

/**
 * Create a mock OpenRouter chat response
 */
export const createChatResponse = (
  content = "Generated narrative text..."
) => ({
  choices: [
    {
      message: {
        content,
      },
    },
  ],
});

/**
 * Create a mock OpenRouter send function
 */
export const createMockSend = (response = createChatResponse()) =>
  jest.fn().mockResolvedValue(response);

/**
 * Setup OpenRouter mock with a given send function
 */
export const setupOpenRouterMock = (
  mockOpenRouter: jest.Mock,
  sendFn: jest.Mock
): void => {
  mockOpenRouter.mockImplementation(() => ({
    chat: { send: sendFn },
  }));
};

// ============================================================================
// Test Environment Setup
// ============================================================================

/**
 * Setup environment for tests
 */
export const setupTestEnv = () => {
  process.env.DISCORD_TOKEN = "test-token";
  process.env.DISCORD_CLIENT_ID = "test-client-id";
  process.env.LORE_CHANNEL_ID = "123456789";
  process.env.GOOGLE_AI_API_KEY = "test-google-ai-key";
  process.env.GLYPHBOTS_API_URL = "https://glyphbots.com";
  process.env.LOG_LEVEL = "info";
};

/**
 * Clear test environment
 */
export const clearTestEnv = () => {
  delete process.env.DISCORD_TOKEN;
  delete process.env.DISCORD_CLIENT_ID;
  delete process.env.LORE_CHANNEL_ID;
  delete process.env.GOOGLE_AI_API_KEY;
  delete process.env.GLYPHBOTS_API_URL;
  delete process.env.LOG_LEVEL;
};
