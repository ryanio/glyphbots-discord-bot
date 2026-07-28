/**
 * `/listings`.
 *
 * OpenSea's best-listings response carries no token id we can trust to map
 * back to a bot, so the original listed price and seller only. That is kept.
 */

import { EmbedBuilder } from "@discordjs/builders";
import { createDisplayNameResolver } from "../api/display-name";
import { getOpenSeaCollectionUrl } from "../api/opensea";
import type { OpenSeaListing } from "../api/types";
import { COLORS } from "../config";
import { linkButtonRow } from "../discord/buttons";
import { embedReply, errorReply, formatActor } from "../discord/embeds";
import type { CommandHandler } from "./context";
import { formatEthAmount } from "./format";

const FETCH_LIMIT = 10;
const DISPLAY_LIMIT = 8;

/**
 * A listing as the endpoint actually answers, rather than as it is declared.
 *
 * `OpenSeaListing` says price and `protocol_data` are always there, three
 * levels deep and all required. The best-listings endpoint is the least
 * reliable of the ones this bot reads, and a listing mid-cancellation comes
 * back with the wrapper and nothing under it, which turned a straight read
 * into a thrown handler and no answer at all. Same trick as `/floor`
 * (`floor.ts:45`): cast to the loose shape, then guard each read. Keeping the
 * field names tied to `OpenSeaListing` means a rename still fails `tsc` here.
 */
type LooseListing = {
  price?: { current?: Partial<OpenSeaListing["price"]["current"]> };
  protocol_data?: {
    parameters?: Partial<OpenSeaListing["protocol_data"]["parameters"]>;
  };
};

type ListingRow = { price: string; seller: string };

/**
 * One row, or null when the listing is missing a price or a seller.
 *
 * The seller stays an address here and is named later, because naming costs a
 * request each and there is no point spending one on a row that is about to be
 * dropped for having no price.
 */
const readListing = (listing: OpenSeaListing): ListingRow | null => {
  const loose = listing as LooseListing;
  const current = loose.price?.current;
  const offerer = loose.protocol_data?.parameters?.offerer;

  if (
    current?.value === undefined ||
    typeof current.decimals !== "number" ||
    !offerer
  ) {
    return null;
  }

  return {
    price: formatEthAmount(current.value, current.decimals),
    seller: offerer,
  };
};

export const handleListings: CommandHandler = async (ctx) => {
  const listings = await ctx.opensea.fetchListings(FETCH_LIMIT);
  const rows = listings
    .map(readListing)
    .filter((row): row is ListingRow => row !== null)
    .slice(0, DISPLAY_LIMIT);

  // Also the answer when every listing came back unreadable. From the caller's
  // side there is nothing to show either way.
  if (rows.length === 0) {
    return errorReply(
      "📋 No Active Listings",
      "No GlyphBots are currently listed for sale on OpenSea."
    );
  }

  // One resolver for the reply: the cheapest eight are frequently the same
  // seller relisting, so the cache usually collapses this to one or two calls.
  const names = createDisplayNameResolver(ctx.opensea);
  const listingLines: string[] = [];
  for (const [i, row] of rows.entries()) {
    const seller = formatActor(await names.resolve(row.seller));
    listingLines.push(`**${i + 1}.** ${row.price}\n└ Seller: ${seller}`);
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.listing)
    .setTitle("🏷️ Cheapest GlyphBots For Sale")
    .setDescription(listingLines.join("\n\n"))
    .setFooter({ text: "Data from OpenSea • Prices may change" })
    .setTimestamp();

  return embedReply(embed, [
    linkButtonRow([
      {
        label: "Browse on OpenSea",
        url: getOpenSeaCollectionUrl(),
        emoji: "🛒",
      },
    ]),
  ]);
};
