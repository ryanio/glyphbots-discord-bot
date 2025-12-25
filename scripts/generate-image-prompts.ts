/**
 * Generate Image Prompts Script
 *
 * Uses Google AI to generate enhanced image prompts based on example bot data.
 * Saves prompts to a directory for use in Twitter thread.
 */

import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchBot } from "../src/api/glyphbots";
import { generateText } from "../src/api/google-ai";
import { prefixedLogger } from "../src/lib/logger";

const log = prefixedLogger("GeneratePrompts");

/** Example bot token IDs to use for generating prompts */
const EXAMPLE_BOT_IDS = [1, 100, 500, 1000, 2369, 5000, 7777, 10_000];

/** Output directory for generated prompts */
const OUTPUT_DIR = join(process.cwd(), "generated-prompts");

/** Image prompt templates */
const IMAGE_TYPES = [
  {
    name: "hero-header",
    description: "Hero/header image showing two bots facing off in arena",
  },
  {
    name: "combat-mechanics",
    description: "Infographic showing the three combat stances system",
  },
  {
    name: "spectator-actions",
    description: "Arena crowd scene with spectator action buttons visible",
  },
  {
    name: "ai-narrative",
    description:
      "Dramatic battle moment with AI-generated narrative text overlay",
  },
  {
    name: "victory-scene",
    description: "Victory celebration scene with triumphant bot",
  },
  {
    name: "stats-leaderboard",
    description: "Futuristic leaderboard interface showing top fighters",
  },
] as const;

/**
 * Build base prompt for image type
 */
const buildBasePrompt = (imageType: (typeof IMAGE_TYPES)[number]): string => {
  const basePrompts: Record<string, string> = {
    "hero-header":
      "Futuristic cyberpunk arena with two robotic warriors facing off. One robot (red accents, angular design) on the left, another (blue accents, sleek design) on the right. Dramatic lighting, neon arena floor, crowd silhouettes in background. Text overlay space for 'GLYPHBOTS ARENA'. Epic battle atmosphere, high quality digital art, 16:9 aspect ratio.",
    "combat-mechanics":
      "Split screen showing three combat stances: aggressive (red energy, forward-leaning pose), defensive (blue shield aura, guarded stance), deceptive (purple mist, evasive pose). Rock-paper-scissors symbols connecting them. Cyberpunk arena background, clean UI design, infographic style, 16:9 aspect ratio.",
    "spectator-actions":
      "Arena crowd scene from above showing spectators with action buttons: red cheer button, blue cheer button, bloodlust button (skull icon), surge button (lightning). Energy meter at 100% with glowing effects. Futuristic arena setting, isometric view, UI elements visible, 16:9 aspect ratio.",
    "ai-narrative":
      "Dramatic battle moment: robot warrior unleashing a critical hit attack, energy explosion at impact. Text overlay showing AI-generated narrative text in futuristic font. Cyberpunk arena background, cinematic composition, dramatic lighting, 16:9 aspect ratio.",
    "victory-scene":
      "Victory celebration scene: triumphant robot warrior standing over defeated opponent, crowd cheering in background. Epic lighting, particle effects, neon arena setting. 'VICTORY' text in bold futuristic font. High quality digital art, cinematic composition, 16:9 aspect ratio.",
    "stats-leaderboard":
      "Futuristic leaderboard interface showing top 3 robot warriors with stats (wins, losses, streaks). Clean UI design, neon accents, holographic display style. Arena background blurred, focus on stats panel, 16:9 aspect ratio.",
  };

  return basePrompts[imageType.name] ?? "";
};

/**
 * Generate enhanced prompt using AI with bot context
 */
const generateEnhancedPrompt = async (
  imageType: (typeof IMAGE_TYPES)[number],
  bot1: { name: string; traits: Array<{ value: string }>; tokenId: number },
  bot2?: { name: string; traits: Array<{ value: string }>; tokenId: number }
): Promise<string> => {
  const basePrompt = buildBasePrompt(imageType);
  const bot1Traits = bot1.traits
    .slice(0, 4)
    .map((t) => t.value)
    .join(", ");
  const bot2Traits = bot2
    ? bot2.traits
        .slice(0, 4)
        .map((t) => t.value)
        .join(", ")
    : "";

  const contextPrompt = `
You are creating an image generation prompt for a Twitter/X thread about GlyphBots Arena.

IMAGE TYPE: ${imageType.description}
BASE PROMPT: ${basePrompt}

${bot2 ? `BOT 1: ${bot1.name} (${bot1Traits})\nBOT 2: ${bot2.name} (${bot2Traits})` : `BOT: ${bot1.name} (${bot1Traits})`}

Enhance the base prompt to be more specific and visually compelling while keeping it concise (2-3 sentences max). Include specific visual details that would make this image stand out on social media. Keep the 16:9 aspect ratio mention and quality descriptors.

Return ONLY the enhanced prompt, no explanation.`;

  try {
    const enhanced = await generateText({
      systemPrompt:
        "You are an expert at creating detailed, visually compelling image generation prompts for social media. You create concise, specific prompts that generate stunning artwork.",
      userPrompt: contextPrompt,
      maxTokens: 200,
      temperature: 0.8,
    });

    return enhanced ?? basePrompt;
  } catch (_error) {
    log.warn(`Failed to enhance prompt for ${imageType.name}, using base`);
    return basePrompt;
  }
};

/**
 * Generate all image prompts
 */
const generateAllPrompts = async (): Promise<void> => {
  log.info("Starting image prompt generation...");

  // Fetch example bots
  log.info(`Fetching example bots: ${EXAMPLE_BOT_IDS.join(", ")}`);
  const fetchedBots = await Promise.all(
    EXAMPLE_BOT_IDS.map((id) => fetchBot(id))
  );

  const validBots = fetchedBots.filter(
    (bot): bot is NonNullable<typeof bot> => bot !== null
  );

  if (validBots.length < 2) {
    log.error("Need at least 2 valid bots to generate prompts");
    process.exit(1);
  }

  log.info(`Fetched ${validBots.length} valid bots`);

  // Create output directory
  await mkdir(OUTPUT_DIR, { recursive: true });

  // Generate prompts for each image type
  const allPrompts: Array<{
    type: string;
    prompt: string;
    bots?: { bot1: number; bot2?: number };
  }> = [];

  for (const imageType of IMAGE_TYPES) {
    log.info(`Generating prompt for: ${imageType.name}`);

    // For hero/victory/narrative, use two bots
    // For others, use one bot or none
    const needsTwoBots = [
      "hero-header",
      "victory-scene",
      "ai-narrative",
    ].includes(imageType.name);

    if (needsTwoBots && validBots.length >= 2) {
      const bot1 = validBots[0];
      const bot2 = validBots[1];
      const prompt = await generateEnhancedPrompt(imageType, bot1, bot2);
      allPrompts.push({
        type: imageType.name,
        prompt,
        bots: { bot1: bot1.tokenId, bot2: bot2.tokenId },
      });
    } else {
      const bot1 = validBots[0];
      const prompt = await generateEnhancedPrompt(imageType, bot1);
      allPrompts.push({
        type: imageType.name,
        prompt,
        bots: { bot1: bot1.tokenId },
      });
    }
  }

  // Save individual prompt files
  for (const { type, prompt } of allPrompts) {
    const filename = `${type}.txt`;
    const filepath = join(OUTPUT_DIR, filename);
    await writeFile(filepath, prompt, "utf-8");
    log.info(`Saved: ${filename}`);
  }

  // Save combined JSON file
  const jsonPath = join(OUTPUT_DIR, "prompts.json");
  await writeFile(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        bots: validBots.map((b) => ({
          tokenId: b.tokenId,
          name: b.name,
          traits: b.traits.slice(0, 4).map((t) => t.value),
        })),
        prompts: allPrompts,
      },
      null,
      2
    ),
    "utf-8"
  );
  log.info("Saved: prompts.json");

  // Save markdown summary
  const mdPath = join(OUTPUT_DIR, "README.md");
  const mdContent = `# Generated Image Prompts

Generated: ${new Date().toISOString()}

## Example Bots Used

${validBots
  .map(
    (b) =>
      `- **${b.name}** (#${b.tokenId}): ${b.traits
        .slice(0, 4)
        .map((t) => t.value)
        .join(", ")}`
  )
  .join("\n")}

## Prompts

${allPrompts.map((p) => `### ${p.type}\n\n\`\`\`\n${p.prompt}\n\`\`\`\n`).join("\n")}
`;
  await writeFile(mdPath, mdContent, "utf-8");
  log.info("Saved: README.md");

  log.info(`✅ Generated ${allPrompts.length} prompts in ${OUTPUT_DIR}`);
};

// Run the script
generateAllPrompts().catch((error) => {
  log.error("Failed to generate prompts:", error);
  process.exit(1);
});
