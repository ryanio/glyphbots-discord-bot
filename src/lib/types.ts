/** GlyphBots API Types */

export type Trait = {
  trait_type: string;
  value: string;
};

export type UnicodeInfo = {
  unicode: string[];
  textContent: string[];
  colors: {
    background: string;
    text: string;
  };
};

export type Bot = {
  id: string;
  name: string;
  tokenId: number;
  traits: Trait[];
  rarityRank: number;
  unicode: UnicodeInfo;
  burnedAt: string | null;
  burnedBy: string | null;
};

export type MissionInfo = {
  type: string;
  objective: string;
  setting: string;
  threat: string;
  mechanic: string;
  timeContext: string;
  stakesSuccess: string;
  stakesFailure: string;
};

export type Ability = {
  name: string;
  effect: string;
  cooldown: string;
  resource: string;
};

export type StoryArc = {
  id: string;
  title: string;
  role: string;
  faction: string;
  mission: MissionInfo;
  abilities: Ability[];
  symbolBias: string[];
  environmentObjects: string[];
  snippet: string;
};

export type BotStory = {
  arc: StoryArc;
  storySeed: number;
  storyPowers: string[];
  storyStats: Record<string, number>;
  storySnippet: string;
  missionBrief: string;
};

export type BotStoryResponse = {
  story: BotStory | null;
  error?: string;
};

export type BotResponse = {
  bot: Bot;
};

/** Artifact Types */

export type Artifact = {
  id: string;
  botTokenId: number;
  imageUrl: string;
  title: string;
  createdAt: string;
  mintedAt: string | null;
  contractTokenId: number | null;
  mintQuantity: number | null;
  aicArtworkIds?: number[];
  minter: string | null;
  imageCid?: string;
  mintTxHash?: string;
  sourceBotIds?: number[];
  durationMs?: number;
  type: string | null;
};

export type ArtifactsListResponse = {
  ok: boolean;
  items: Artifact[];
  nextCursor?: string | null;
  error?: string;
};

export type ArtifactResponse = {
  ok: boolean;
  artifact?: Artifact;
  error?: string;
};

export type ArtifactsSummaryResponse = {
  total: number;
  last1d: number;
  last7d: number;
  last30d: number;
};

/** Lore Generation Types */

export type LoreContext = {
  artifact: Artifact;
  bot: Bot;
  story: BotStory | null;
};

export type GeneratedLore = {
  title: string;
  narrative: string;
  artifact: Artifact;
  bot: Bot;
};

/** Configuration Types */

export type Config = {
  discordToken: string;
  discordClientId: string;
  discordGuildId: string | null;
  loreChannelId: string;
  loreMinIntervalMinutes: number;
  loreMaxIntervalMinutes: number;
  arenaChannelId: string | null;
  arenaChallengeTimeoutSeconds: number;
  arenaRoundTimeoutSeconds: number;
  arenaMaxRounds: number;
  playgroundChannelId: string | null;
  playgroundMinIntervalMinutes: number;
  playgroundMaxIntervalMinutes: number;
  googleAiApiKey: string;
  glyphbotsApiUrl: string;
  logLevel: string;
};
