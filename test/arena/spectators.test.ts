import {
  applyCrowdAction,
  calculateCrowdBonus,
  getCrowdStatusMessage,
  triggerArenaEvent,
} from "../../src/arena/spectators";
import {
  acceptChallenge,
  activateSpectators,
  addPendingSpectator,
  cleanupBattle,
  createBattle,
  createFighterState,
  getBattle,
} from "../../src/arena/state";
import type { Bot, BotStory } from "../../src/lib/types";

const createMockBot = (tokenId: number, name: string): Bot => ({
  id: `bot-${tokenId}`,
  name,
  tokenId,
  traits: [],
  rarityRank: 100,
  unicode: {
    unicode: [],
    textContent: [],
    colors: { background: "#000000", text: "#ffffff" },
  },
  burnedAt: null,
  burnedBy: null,
});

const createMockStory = (
  stats?: Partial<BotStory["storyStats"]>
): BotStory => ({
  arc: {
    id: "arc-1",
    title: "Test Arc",
    role: "Warrior",
    faction: "Guardians",
    mission: {
      type: "Combat",
      objective: "Destroy",
      setting: "Arena",
      threat: "Enemy",
      mechanic: "Battle",
      timeContext: "Now",
      stakesSuccess: "Victory",
      stakesFailure: "Defeat",
    },
    abilities: [],
    symbolBias: [],
    environmentObjects: [],
    snippet: "A mighty warrior",
  },
  storySeed: 12_345,
  storyPowers: [],
  storyStats: {
    strength: 70,
    agility: 60,
    intellect: 50,
    endurance: stats?.endurance ?? 50,
    luck: 40,
    charisma: 30,
    ...stats,
  },
  storySnippet: "A mighty warrior rises",
  missionBrief: "Defeat the enemy",
});

describe("Arena Spectators", () => {
  let battleId: string;
  let spectatorId: string;

  beforeEach(() => {
    const bot1 = createMockBot(1, "Red Fighter");
    const bot2 = createMockBot(2, "Blue Fighter");
    const story1 = createMockStory();
    const story2 = createMockStory();

    const redFighter = createFighterState("user1", "User1", bot1, story1);
    const battle = createBattle("channel-1", redFighter);
    battleId = battle.id;

    const blueFighter = createFighterState("user2", "User2", bot2, story2);
    acceptChallenge(battle, blueFighter);

    spectatorId = "spectator-1";
    addPendingSpectator(battle, spectatorId);
    activateSpectators(battle);
  });

  afterEach(() => {
    const battle = getBattle(battleId);
    if (battle) {
      cleanupBattle(battleId);
    }
  });

  describe("applyCrowdAction", () => {
    it("should reject action from non-spectator", () => {
      const battle = getBattle(battleId);
      if (!battle) {
        throw new Error("Battle not found");
      }

      const result = applyCrowdAction(battle, "not-a-spectator", "cheer_red");

      expect(result.success).toBe(false);
      expect(result.message).toContain("not a spectator");
    });

    it("should apply cheer_red action", () => {
      const battle = getBattle(battleId);
      if (!battle) {
        throw new Error("Battle not found");
      }

      const initialEnergy = battle.crowdEnergy;
      const result = applyCrowdAction(battle, spectatorId, "cheer_red");

      expect(result.success).toBe(true);
      expect(result.message).toContain("cheering for");
      expect(battle.crowdEnergy).toBe(initialEnergy + 5);
      expect(battle.spectators.get(spectatorId)?.cheeredFor).toBe("red");
    });

    it("should apply cheer_blue action", () => {
      const battle = getBattle(battleId);
      if (!battle) {
        throw new Error("Battle not found");
      }

      const initialEnergy = battle.crowdEnergy;
      const result = applyCrowdAction(battle, spectatorId, "cheer_blue");

      expect(result.success).toBe(true);
      expect(result.message).toContain("cheering for");
      expect(battle.crowdEnergy).toBe(initialEnergy + 5);
      expect(battle.spectators.get(spectatorId)?.cheeredFor).toBe("blue");
    });

    it("should reject cheer_blue when no blue fighter", () => {
      const battle = getBattle(battleId);
      if (!battle) {
        throw new Error("Battle not found");
      }

      battle.blueFighter = null;
      const result = applyCrowdAction(battle, spectatorId, "cheer_blue");

      expect(result.success).toBe(false);
      expect(result.message).toContain("No blue fighter");
    });

    it("should apply bloodlust action", () => {
      const battle = getBattle(battleId);
      if (!battle) {
        throw new Error("Battle not found");
      }

      const initialEnergy = battle.crowdEnergy;
      const redBuffsBefore = battle.redFighter.buffs.length;
      const blueBuffsBefore = battle.blueFighter?.buffs.length ?? 0;

      const result = applyCrowdAction(battle, spectatorId, "bloodlust");

      expect(result.success).toBe(true);
      expect(result.message).toContain("BLOODLUST");
      expect(battle.crowdEnergy).toBe(initialEnergy + 10);
      expect(battle.redFighter.buffs.length).toBe(redBuffsBefore + 1);
      expect(battle.blueFighter?.buffs.length).toBe(blueBuffsBefore + 1);

      const bloodlustBuff = battle.redFighter.buffs.find(
        (b) => b.source === "bloodlust"
      );
      expect(bloodlustBuff).toBeDefined();
      expect(bloodlustBuff?.type).toBe("damage");
      expect(bloodlustBuff?.value).toBe(10);
    });

    it("should apply surge action", () => {
      const battle = getBattle(battleId);
      if (!battle) {
        throw new Error("Battle not found");
      }

      const initialEnergy = battle.crowdEnergy;
      const result = applyCrowdAction(battle, spectatorId, "surge");

      expect(result.success).toBe(true);
      expect(result.message).toContain("SURGE");
      expect(battle.crowdEnergy).toBe(initialEnergy + 15);
    });

    it("should trigger arena event at 100% crowd energy", () => {
      const battle = getBattle(battleId);
      if (!battle) {
        throw new Error("Battle not found");
      }

      battle.crowdEnergy = 90;
      const result = applyCrowdAction(battle, spectatorId, "surge");

      expect(result.success).toBe(true);
      expect(result.triggeredEvent).toBeDefined();
      expect(result.triggeredEvent?.type).toBeDefined();
      expect(result.triggeredEvent?.description).toBeDefined();
      expect(battle.crowdEnergy).toBe(0);
    });

    it("should cap crowd energy at 100", () => {
      const battle = getBattle(battleId);
      if (!battle) {
        throw new Error("Battle not found");
      }

      battle.crowdEnergy = 98;
      applyCrowdAction(battle, spectatorId, "surge");

      expect(battle.crowdEnergy).toBeLessThanOrEqual(100);
    });
  });

  describe("triggerArenaEvent", () => {
    it("should trigger power surge event", () => {
      const battle = getBattle(battleId);
      if (!battle) {
        throw new Error("Battle not found");
      }

      // Mock random to force power surge
      const originalRandom = Math.random;
      Math.random = jest.fn(() => 0.1);

      const event = triggerArenaEvent(battle);

      expect(event.type).toBe("power_surge");
      expect(event.description).toContain("POWER SURGE");
      expect(event.redEffect || event.blueEffect).toBeDefined();

      Math.random = originalRandom;
    });

    it("should trigger chaos field event", () => {
      const battle = getBattle(battleId);
      if (!battle) {
        throw new Error("Battle not found");
      }

      // Mock random to force chaos field
      const originalRandom = Math.random;
      Math.random = jest.fn(() => 0.4);

      const event = triggerArenaEvent(battle);

      expect(event.type).toBe("chaos_field");
      expect(event.description).toContain("CHAOS FIELD");
      expect(event.redEffect).toBeDefined();
      expect(event.blueEffect).toBeDefined();

      Math.random = originalRandom;
    });

    it("should trigger arena hazard event", () => {
      const battle = getBattle(battleId);
      if (!battle) {
        throw new Error("Battle not found");
      }

      // Mock random to force arena hazard
      const originalRandom = Math.random;
      Math.random = jest.fn(() => 0.7);

      const redHpBefore = battle.redFighter.hp;
      const blueHpBefore = battle.blueFighter?.hp ?? 0;

      const event = triggerArenaEvent(battle);

      expect(event.type).toBe("arena_hazard");
      expect(event.description).toContain("ARENA HAZARD");
      expect(event.redDamage).toBeDefined();
      expect(event.blueDamage).toBeDefined();
      expect(battle.redFighter.hp).toBeLessThan(redHpBefore);
      if (battle.blueFighter) {
        expect(battle.blueFighter.hp).toBeLessThan(blueHpBefore);
      }

      Math.random = originalRandom;
    });

    it("should apply arena hazard damage based on endurance", () => {
      const battle = getBattle(battleId);
      if (!battle) {
        throw new Error("Battle not found");
      }

      battle.redFighter.story = createMockStory({ endurance: 100 });
      battle.blueFighter = createFighterState(
        "user2",
        "User2",
        createMockBot(2, "Blue"),
        createMockStory({ endurance: 30 })
      );

      const originalRandom = Math.random;
      Math.random = jest.fn(() => 0.7);

      const event = triggerArenaEvent(battle);

      expect(event.type).toBe("arena_hazard");
      if (event.redDamage !== undefined && event.blueDamage !== undefined) {
        expect(event.redDamage).toBeLessThan(event.blueDamage);
      }

      Math.random = originalRandom;
    });
  });

  describe("calculateCrowdBonus", () => {
    it("should return 0 when no spectators cheer", () => {
      const battle = getBattle(battleId);
      if (!battle) {
        throw new Error("Battle not found");
      }

      const bonus = calculateCrowdBonus(battle, true);
      expect(bonus).toBe(0);
    });

    it("should calculate bonus for red fighter", () => {
      const battle = getBattle(battleId);
      if (!battle) {
        throw new Error("Battle not found");
      }

      applyCrowdAction(battle, spectatorId, "cheer_red");

      const bonus = calculateCrowdBonus(battle, true);
      expect(bonus).toBe(5);
    });

    it("should calculate bonus for blue fighter", () => {
      const battle = getBattle(battleId);
      if (!battle) {
        throw new Error("Battle not found");
      }

      applyCrowdAction(battle, spectatorId, "cheer_blue");

      const bonus = calculateCrowdBonus(battle, false);
      expect(bonus).toBe(5);
    });

    it("should cap bonus at 50%", () => {
      const battle = getBattle(battleId);
      if (!battle) {
        throw new Error("Battle not found");
      }

      // Add 15 spectators all cheering for red
      for (let i = 0; i < 15; i++) {
        const specId = `spectator-${i}`;
        addPendingSpectator(battle, specId);
        activateSpectators(battle);
        applyCrowdAction(battle, specId, "cheer_red");
      }

      const bonus = calculateCrowdBonus(battle, true);
      expect(bonus).toBe(50);
    });
  });

  describe("getCrowdStatusMessage", () => {
    it("should format crowd status correctly", () => {
      const battle = getBattle(battleId);
      if (!battle) {
        throw new Error("Battle not found");
      }

      battle.crowdEnergy = 50;
      const message = getCrowdStatusMessage(battle);

      expect(message).toContain("SPECTATORS");
      expect(message).toContain("CROWD ENERGY");
      expect(message).toContain("50%");
    });

    it("should show cheer counts", () => {
      const battle = getBattle(battleId);
      if (!battle) {
        throw new Error("Battle not found");
      }

      applyCrowdAction(battle, spectatorId, "cheer_red");

      const message = getCrowdStatusMessage(battle);
      expect(message).toContain("cheering red");
    });

    it("should warn when crowd energy is critical", () => {
      const battle = getBattle(battleId);
      if (!battle) {
        throw new Error("Battle not found");
      }

      battle.crowdEnergy = 85;
      const message = getCrowdStatusMessage(battle);

      expect(message).toContain("CRITICAL");
      expect(message).toContain("imminent");
    });
  });
});
