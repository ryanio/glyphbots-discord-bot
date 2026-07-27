/**
 * Slash Command Deployment Script
 *
 * Deploys slash commands to Discord.
 * Usage:
 *   npm run commands:deploy          # Guild deployment if DISCORD_GUILD_ID is set, otherwise global
 *   npm run commands:deploy -- --global  # Force global deployment (takes ~1 hour)
 */

import "dotenv/config";

import { REST, Routes } from "discord.js";
import { DISCORD_API_VERSION } from "../lib/constants";
import { getCommandsJSON } from "./index";

async function deploy(): Promise<void> {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!token) {
    console.error("❌ DISCORD_TOKEN environment variable is required");
    process.exit(1);
  }

  if (!clientId) {
    console.error("❌ DISCORD_CLIENT_ID environment variable is required");
    process.exit(1);
  }

  // Default to guild deployment if DISCORD_GUILD_ID is set, otherwise global
  // Can override with --global flag
  const isGlobalDeploy = process.argv.includes("--global");
  const isGuildDeploy = !isGlobalDeploy && !!guildId;

  if (isGuildDeploy && !guildId) {
    console.error(
      "❌ DISCORD_GUILD_ID environment variable is required for guild deployment"
    );
    process.exit(1);
  }

  const commands = getCommandsJSON();
  const rest = new REST({ version: DISCORD_API_VERSION }).setToken(token);

  console.log("┌─────────────────────────────────────────────");
  console.log("│ 🤖 GlyphBots Command Deployment");
  console.log("├─────────────────────────────────────────────");
  console.log(`│ 📦 Commands: ${commands.length}`);
  console.log(
    `│ 🎯 Target: ${isGuildDeploy ? `Guild (${guildId})` : "Global"}`
  );
  console.log("└─────────────────────────────────────────────");
  console.log("");

  try {
    console.log("⏳ Deploying commands...");

    if (isGuildDeploy && guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commands,
      });
      console.log("✅ Guild commands deployed successfully!");
      console.log("   Commands are available immediately in your server.");
    } else {
      await rest.put(Routes.applicationCommands(clientId), {
        body: commands,
      });
      console.log("✅ Global commands deployed successfully!");
      console.log("   Commands may take up to 1 hour to propagate.");
    }

    console.log("");
    console.log("📋 Deployed commands:");
    for (const cmd of commands) {
      const cmdObj = cmd as { name: string; description: string };
      console.log(`   /${cmdObj.name} - ${cmdObj.description}`);
    }
  } catch (error) {
    console.error("❌ Failed to deploy commands:", error);
    process.exit(1);
  }
}

deploy();
