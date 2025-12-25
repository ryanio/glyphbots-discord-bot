/**
 * Help Embed Builders
 *
 * Rich embeds for help and information display.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type HexColorString,
} from "discord.js";

/** GlyphBots brand color */
const GLYPHBOTS_COLOR: HexColorString = "#00ff88";

/** Arena color (red/combat) */
const ARENA_COLOR: HexColorString = "#ff4444";

/** Spectator color (purple) */
const SPECTATOR_COLOR: HexColorString = "#9966ff";

/** Tips color (orange) */
const TIPS_COLOR: HexColorString = "#ffaa00";

/**
 * Arena Quick Start Guide
 */
export const arenaQuickstart = new EmbedBuilder()
  .setColor(ARENA_COLOR)
  .setTitle("⚔ ═══ Arena Quick Start ═══ ⚔")
  .setDescription("Ready to prove your bot's worth? Here's how:")
  .addFields(
    {
      name: "◈ Start a Challenge ◈",
      value:
        "`/arena challenge bot:4421`\nReplace 4421 with your bot's token ID",
    },
    {
      name: "◈ Accept a Challenge ◈",
      value:
        "Click **[Accept Challenge]** on any open battle\nThen select which of your bots will fight",
    },
    {
      name: "◈ Fight! ◈",
      value:
        "◈ Choose your opening stance\n◈ Select abilities each round (30 sec)\n◈ Watch the AI narrate your clash!",
    }
  )
  .setFooter({
    text: "◈ Pro tip: Type /info bot <id> to check a bot's stats before challenging! ◈",
  });

/**
 * Arena action buttons
 */
export const arenaButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder()
    .setCustomId("arena_my_stats")
    .setLabel("My Stats")
    .setStyle(ButtonStyle.Secondary)
    .setEmoji("📊"),
  new ButtonBuilder()
    .setCustomId("arena_leaderboard")
    .setLabel("Leaderboard")
    .setStyle(ButtonStyle.Secondary)
    .setEmoji("🏆")
);

/**
 * Embed Bot Syntax Help
 */
export const embedBotSyntax = new EmbedBuilder()
  .setColor(GLYPHBOTS_COLOR)
  .setTitle("◈ Quick Reference: Bot & Artifact Lookups ◈")
  .setDescription("Instantly view any bot or artifact using slash commands!")
  .addFields(
    {
      name: "◈ Bot Lookups ◈",
      value: [
        "`/info bot id:123` ⟶ View Bot #123",
        "`/info bot id:4421` ⟶ View Bot #4421",
      ].join("\n"),
      inline: true,
    },
    {
      name: "◈ Artifact Lookups ◈",
      value: [
        "`/info artifact id:456` ⟶ View Artifact #456",
        "`/info artifact id:1203` ⟶ View Artifact #1203",
      ].join("\n"),
      inline: true,
    }
  )
  .setFooter({
    text: "Try it now! Type /info bot id:1 to see the first GlyphBot! ◈",
  });

/**
 * Spectator Guide
 */
export const spectatorGuide = new EmbedBuilder()
  .setColor(SPECTATOR_COLOR)
  .setTitle("◉ Spectator Mode ◉")
  .setDescription("Not fighting? You can still shape the battle!")
  .addFields(
    {
      name: "◈ Crowd Actions ◈",
      value: [
        "◈ **Cheer Red** ⟶ +5% damage to red fighter",
        "◈ **Cheer Blue** ⟶ +5% damage to blue fighter",
        "◈ **Bloodlust** ⟶ Both +10% dmg, -10% def",
        "⚡ **Surge** ⟶ +15 crowd energy",
      ].join("\n"),
    },
    {
      name: "✦ Arena Events ✦",
      value:
        "When crowd energy hits **100%**, chaos ensues!\nRandom arena events can flip the entire battle.",
    }
  )
  .setFooter({ text: "Click [Spectate] on any battle to join the crowd! ◉" });

/**
 * Slash Commands Overview
 */
export const slashCommands = new EmbedBuilder()
  .setColor(GLYPHBOTS_COLOR)
  .setTitle("◈ Slash Commands ◈")
  .setDescription("Type `/` to see all available commands!")
  .addFields(
    {
      name: "◈ Global ◈",
      value: "`/help` `/info bot` `/info artifact` `/tips`",
      inline: true,
    },
    {
      name: "⚔ Arena ⚔",
      value:
        "`/arena challenge` `/arena stats`\n`/arena leaderboard` `/arena history`",
      inline: true,
    },
    {
      name: "◉ Playground ◉",
      value: "`/spotlight` `/random bot`\n`/random artifact` `/random world`",
      inline: true,
    }
  );

/**
 * Channel Overview
 */
export const channelOverview = new EmbedBuilder()
  .setColor(GLYPHBOTS_COLOR)
  .setTitle("◈ GlyphBots AI Channels ◈")
  .setDescription("")
  .addFields(
    {
      name: "◈ #lore ◈",
      value:
        "AI-generated stories about recently minted artifacts.\nNew narratives every 30 minutes.\n*Just sit back and enjoy!*",
    },
    {
      name: "⚔ #arena ⚔",
      value:
        "Interactive PvP battles between GlyphBots.\nChallenge others, fight in real-time!\n`/arena challenge` `/arena stats`",
    },
    {
      name: "◉ #playground ◉",
      value:
        "Community showcase and onboarding.\nBot spotlights, world postcards, arena recaps!",
    }
  )
  .setFooter({
    text: "◈ Use /info bot or /info artifact for quick lookups in any channel! ◈",
  });

/**
 * Lore Explanation
 */
export const loreExplanation = new EmbedBuilder()
  .setColor(GLYPHBOTS_COLOR)
  .setTitle("◈ About #lore ◈")
  .setDescription(
    "The lore channel features AI-generated micro-fiction about GlyphBots and their artifacts."
  )
  .addFields(
    {
      name: "◈ How It Works ◈",
      value:
        "Every 30 minutes, the bot selects a recently minted artifact and generates a unique narrative in one of 9 different styles.",
    },
    {
      name: "◉ Narrative Styles ◉",
      value:
        "Cinematic • Transmission • First Person • Poetic • Log Entry • Memory • Myth • Noir • Broadcast",
    },
    {
      name: "◈ What's Included ◈",
      value:
        "Each post includes:\n◈ AI-generated story\n◈ Artifact image\n◈ Links to view the bot and artifact",
    }
  )
  .setFooter({
    text: "Stories are generated using the artifact image for context! ◈",
  });

/**
 * Playground Guide
 */
export const playgroundGuide = new EmbedBuilder()
  .setColor(GLYPHBOTS_COLOR)
  .setTitle("◉ About #playground ◉")
  .setDescription(
    "The playground channel is your hub for community content and discovery!"
  )
  .addFields(
    {
      name: "◈ Bot Spotlights ◈",
      value: "Featured bots with full stats, powers, and lore",
    },
    {
      name: "◈ World Postcards ◈",
      value: "Atmospheric descriptions of world artifacts",
    },
    {
      name: "◈ Item Discovery ◈",
      value: "Newly minted items with AI-generated lore",
    },
    {
      name: "◈ Arena Recaps ◈",
      value: "Daily battle summaries and leaderboards",
    },
    {
      name: "◈ Random Encounters ◈",
      value: '"What if?" scenarios featuring random bots',
    }
  )
  .setFooter({ text: "New content every 45-90 minutes! ◉" });

/**
 * Tips content for random selection
 */
export const TIPS = [
  {
    title: "◈ Battle Strategy ◈",
    tip: "Aggressive stance beats Deceptive, Defensive beats Aggressive, Deceptive beats Defensive!",
  },
  {
    title: "◉ Know Your Stats ◉",
    tip: "High AGI bots attack first. High LCK bots crit more. High END bots tank damage.",
  },
  {
    title: "◈ Crowd Power ◈",
    tip: "Spectators can give fighters +5% damage. Rally your friends!",
  },
  {
    title: "✦ Arena Events ✦",
    tip: "At 100% crowd energy, random events trigger. Power surges, chaos fields, arena hazards!",
  },
  {
    title: "◈ Win Streaks ◈",
    tip: "Win 3+ battles in a row to appear on the leaderboard!",
  },
  {
    title: "◈ Weekly Spotlight ◈",
    tip: "Every week, special bots get featured in #playground!",
  },
  {
    title: "⚡ Speed Matters ⚡",
    tip: "The bot with higher Agility attacks first each round!",
  },
  {
    title: "◈ Deceptive Stance ◈",
    tip: "Deceptive stance gives +20% crit chance. High risk, high reward!",
  },
  {
    title: "◈ Defensive Play ◈",
    tip: "Defensive stance gives +15% DEF but -10% ATK. Great against aggressive players!",
  },
  {
    title: "◈ Bloodlust ◈",
    tip: "Spectators can trigger Bloodlust: both fighters deal +10% damage but take -10% defense!",
  },
];

/**
 * Get a random tip embed
 */
export const getRandomTipEmbed = (): EmbedBuilder => {
  const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
  return new EmbedBuilder()
    .setColor(TIPS_COLOR)
    .setTitle(tip.title)
    .setDescription(tip.tip)
    .setFooter({ text: "◈ Use /tips for more tips! ◈" });
};

/**
 * Get help embed based on topic
 */
export const getHelpEmbed = (
  topic: string | null,
  channelId?: string,
  config?: {
    loreChannelId?: string;
    arenaChannelId?: string;
    playgroundChannelId?: string;
  }
): { embed: EmbedBuilder; components?: ActionRowBuilder<ButtonBuilder>[] } => {
  switch (topic) {
    case "arena":
      return { embed: arenaQuickstart, components: [arenaButtons] };
    case "lore":
      return { embed: loreExplanation };
    case "playground":
      return { embed: playgroundGuide };
    case "lookups":
      return { embed: embedBotSyntax };
    case "spectating":
      return { embed: spectatorGuide };
    case "commands":
      return { embed: slashCommands };
    default:
      // Context-aware: show help for current channel
      if (config) {
        if (channelId === config.arenaChannelId) {
          return { embed: arenaQuickstart, components: [arenaButtons] };
        }
        if (channelId === config.loreChannelId) {
          return { embed: loreExplanation };
        }
        if (channelId === config.playgroundChannelId) {
          return { embed: playgroundGuide };
        }
      }
      return { embed: channelOverview };
  }
};
