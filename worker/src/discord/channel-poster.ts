/**
 * Posting to a Discord channel over raw REST.
 *
 * The Node bot went through `client.channels.fetch()` and `channel.send()`,
 * which needs a live gateway client. Here it is one authenticated POST to
 * `/channels/{id}/messages`. `@discordjs/rest` is used rather than bare fetch
 * because it handles 429s for us, and the cron path is exactly where a rate
 * limit is cheap to wait out.
 *
 * `discord.js` itself is never imported. `@discordjs/builders` is, because it
 * is pure and bundles fine.
 */

import { REST } from "@discordjs/rest";
import {
  type RESTPostAPIChannelMessageJSONBody,
  Routes,
} from "discord-api-types/v10";

export type ChannelPoster = {
  /** Rejects on any non-2xx, which is what the caller treats as a failure. */
  send: (body: RESTPostAPIChannelMessageJSONBody) => Promise<void>;
};

/**
 * Build a poster bound to one channel. Token comes from the live `env`, never
 * from a module-scope capture.
 */
export const createChannelPoster = (
  env: { DISCORD_TOKEN: string },
  channelId: string
): ChannelPoster => {
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

  return {
    send: async (body) => {
      await rest.post(Routes.channelMessages(channelId), { body });
    },
  };
};
