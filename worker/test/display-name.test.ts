/**
 * Address to name.
 *
 * Two things are worth pinning down here and they are separate: the preference
 * order between OpenSea's three name fields, which is pure, and the caching,
 * which is the whole reason the resolver is an object rather than a function.
 */

import { describe, expect, it, vi } from "vitest";
import {
  addressOnly,
  createDisplayNameResolver,
  preferredName,
} from "../src/api/display-name";
import type { OpenSeaAccount } from "../src/api/types";

const ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const SHORT = "0xd8dA6…96045";

describe("preferredName", () => {
  it("prefers the OpenSea username over everything else", () => {
    const name = preferredName(
      {
        address: ADDRESS,
        username: "VincentVanDough",
        ens_name: "vvd.eth",
        display_name: "VincentVanDough",
      },
      ADDRESS
    );

    expect(name.label).toBe("VincentVanDough");
    expect(name.ens).toBe("vvd.eth");
    expect(name.isAddress).toBe(false);
  });

  it("falls back to the ENS name when there is no username", () => {
    // The live shape for an address with a reverse record and no OpenSea
    // account: `username` is null, `ens_name` and `display_name` agree.
    const name = preferredName(
      {
        address: ADDRESS,
        username: null,
        ens_name: "vitalik.eth",
        display_name: "vitalik.eth",
      },
      ADDRESS
    );

    expect(name.label).toBe("vitalik.eth");
    expect(name.username).toBeNull();
    expect(name.isAddress).toBe(false);
  });

  it("falls back to display_name when it is the only thing set", () => {
    const name = preferredName(
      { address: ADDRESS, display_name: "Someone" },
      ADDRESS
    );
    expect(name.label).toBe("Someone");
  });

  it("shortens the address when OpenSea knows nothing", () => {
    const name = preferredName(
      { address: ADDRESS, username: null, ens_name: null, display_name: null },
      ADDRESS
    );

    expect(name.label).toBe(SHORT);
    expect(name.isAddress).toBe(true);
  });

  it("treats an empty or whitespace-only name as absent", () => {
    // OpenSea has answered `""` for a token name elsewhere in this API, and a
    // blank label would make `setTitle` throw rather than merely look wrong.
    const name = preferredName(
      { address: ADDRESS, username: "   ", ens_name: "" },
      ADDRESS
    );

    expect(name.label).toBe(SHORT);
    expect(name.isAddress).toBe(true);
  });

  it("answers the short address for no account at all", () => {
    expect(addressOnly(ADDRESS).label).toBe(SHORT);
    expect(addressOnly(ADDRESS).isAddress).toBe(true);
  });
});

describe("createDisplayNameResolver", () => {
  const account = (
    overrides: Partial<OpenSeaAccount> = {}
  ): OpenSeaAccount => ({
    address: ADDRESS,
    username: "someone",
    ...overrides,
  });

  it("looks an address up once however often it is asked", async () => {
    const fetchAccount = vi.fn(() => Promise.resolve(account()));
    const names = createDisplayNameResolver({ fetchAccount });

    await names.resolve(ADDRESS);
    await names.resolve(ADDRESS);
    await names.resolve(ADDRESS.toLowerCase());

    expect(fetchAccount).toHaveBeenCalledTimes(1);
  });

  it("serves a primed account without a request", async () => {
    const fetchAccount = vi.fn(() => Promise.resolve(null));
    const names = createDisplayNameResolver({ fetchAccount });

    names.prime(account({ username: "ryan" }));

    expect((await names.resolve(ADDRESS)).label).toBe("ryan");
    expect(fetchAccount).not.toHaveBeenCalled();
  });

  it("falls back to the address when the lookup throws", async () => {
    // A name is decoration. Whatever OpenSea does, the caller gets a label and
    // no exception.
    const names = createDisplayNameResolver({
      fetchAccount: vi.fn(() => Promise.reject(new Error("429"))),
    });

    const name = await names.resolve(ADDRESS);
    expect(name.label).toBe(SHORT);
    expect(name.isAddress).toBe(true);
  });

  it("caches the failure too, rather than retrying inside one tick", async () => {
    const fetchAccount = vi.fn(() => Promise.resolve(null));
    const names = createDisplayNameResolver({ fetchAccount });

    await names.resolve(ADDRESS);
    await names.resolve(ADDRESS);

    expect(fetchAccount).toHaveBeenCalledTimes(1);
  });
});
