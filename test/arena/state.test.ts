import {
  acceptChallenge,
  activateSpectators,
  addCrowdEnergy,
  addPendingSpectator,
  cleanupBattle,
  createBattle,
  createFighterState,
  forfeitBattle,
  getBattle,
  getUserBattle,
  getWinner,
  isEpicVictory,
  isUserInBattle,
  recordRoundResult,
  setFighterAction,
  setFighterStance,
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

const createMockStory = (): BotStory => ({
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
  storyStats: { strength: 70, agility: 60, endurance: 50, luck: 40 },
  storySnippet: "A mighty warrior rises",
  missionBrief: "Defeat the enemy",
});

describe("Battle State Machine", () => {
  afterEach(() => {
    // Clean up all battles after each test
    const userId1 = "test-user-1";
    const userId2 = "test-user-2";
    const battle1 = getUserBattle(userId1);
    const battle2 = getUserBattle(userId2);
    if (battle1) {
      cleanupBattle(battle1.id);
    }
    if (battle2) {
      cleanupBattle(battle2.id);
    }
  });

  describe("createFighterState", () => {
    it("should create a fighter with correct initial state", () => {
      const bot = createMockBot(1, "Test Bot");
      const story = createMockStory();
      const fighter = createFighterState("user1", "TestUser", bot, story);

      expect(fighter.userId).toBe("user1");
      expect(fighter.username).toBe("TestUser");
      expect(fighter.bot).toBe(bot);
      expect(fighter.story).toBe(story);
      expect(fighter.hp).toBeGreaterThan(0);
      expect(fighter.maxHp).toBeGreaterThan(0);
      expect(fighter.hp).toBe(fighter.maxHp);
      expect(fighter.stance).toBeNull();
      expect(fighter.selectedAction).toBeNull();
      expect(fighter.buffs).toEqual([]);
      expect(fighter.debuffs).toEqual([]);
    });

    it("should calculate HP based on endurance", () => {
      const bot = createMockBot(1, "Test Bot");
      const lowEndStory = createMockStory();
      lowEndStory.storyStats.endurance = 30;

      const highEndStory = createMockStory();
      highEndStory.storyStats.endurance = 100;

      const lowEndFighter = createFighterState(
        "user1",
        "User1",
        bot,
        lowEndStory
      );
      const highEndFighter = createFighterState(
        "user2",
        "User2",
        bot,
        highEndStory
      );

      expect(highEndFighter.maxHp).toBeGreaterThan(lowEndFighter.maxHp);
    });
  });

  describe("createBattle", () => {
    it("should create a battle in challenge phase", () => {
      const bot = createMockBot(1, "Challenger Bot");
      const fighter = createFighterState("test-user-1", "TestUser", bot, null);

      const battle = createBattle("channel1", fighter);

      expect(battle.id).toBeDefined();
      expect(battle.phase).toBe("challenge");
      expect(battle.round).toBe(0);
      expect(battle.redFighter).toBe(fighter);
      expect(battle.blueFighter).toBeNull();
      expect(battle.spectators.size).toBe(0);
      expect(battle.crowdEnergy).toBe(0);
    });

    it("should track the challenger as in battle", () => {
      const bot = createMockBot(1, "Challenger Bot");
      const fighter = createFighterState("test-user-1", "TestUser", bot, null);

      createBattle("channel1", fighter);

      expect(isUserInBattle("test-user-1")).toBe(true);
      expect(isUserInBattle("other-user")).toBe(false);
    });
  });

  describe("acceptChallenge", () => {
    it("should accept a challenge and move to prebattle phase", () => {
      const bot1 = createMockBot(1, "Challenger");
      const bot2 = createMockBot(2, "Opponent");
      const fighter1 = createFighterState("test-user-1", "User1", bot1, null);
      const fighter2 = createFighterState("test-user-2", "User2", bot2, null);

      const battle = createBattle("channel1", fighter1);
      const result = acceptChallenge(battle, fighter2);

      expect(result).toBe(true);
      expect(battle.phase).toBe("prebattle");
      expect(battle.blueFighter).toBe(fighter2);
      expect(isUserInBattle("test-user-2")).toBe(true);
    });

    it("should not allow accepting your own challenge", () => {
      const bot = createMockBot(1, "Challenger");
      const fighter = createFighterState("test-user-1", "User1", bot, null);

      const battle = createBattle("channel1", fighter);
      const result = acceptChallenge(battle, fighter);

      expect(result).toBe(false);
      expect(battle.phase).toBe("challenge");
    });

    it("should not accept if not in challenge phase", () => {
      const bot1 = createMockBot(1, "Challenger");
      const bot2 = createMockBot(2, "Opponent1");
      const bot3 = createMockBot(3, "Opponent2");
      const fighter1 = createFighterState("test-user-1", "User1", bot1, null);
      const fighter2 = createFighterState("test-user-2", "User2", bot2, null);
      const fighter3 = createFighterState("user3", "User3", bot3, null);

      const battle = createBattle("channel1", fighter1);
      acceptChallenge(battle, fighter2);

      const result = acceptChallenge(battle, fighter3);

      expect(result).toBe(false);
    });
  });

  describe("setFighterStance", () => {
    it("should set stance for both fighters", () => {
      const bot1 = createMockBot(1, "Bot1");
      const bot2 = createMockBot(2, "Bot2");
      const fighter1 = createFighterState("test-user-1", "User1", bot1, null);
      const fighter2 = createFighterState("test-user-2", "User2", bot2, null);

      const battle = createBattle("channel1", fighter1);
      acceptChallenge(battle, fighter2);

      setFighterStance(battle, "test-user-1", "aggressive");
      expect(battle.redFighter.stance).toBe("aggressive");
      expect(battle.phase).toBe("prebattle");

      setFighterStance(battle, "test-user-2", "defensive");
      expect(battle.blueFighter?.stance).toBe("defensive");
      expect(battle.phase).toBe("combat");
      expect(battle.round).toBe(1);
    });
  });

  describe("setFighterAction", () => {
    it("should set action for fighters in combat", () => {
      const bot1 = createMockBot(1, "Bot1");
      const bot2 = createMockBot(2, "Bot2");
      const fighter1 = createFighterState("test-user-1", "User1", bot1, null);
      const fighter2 = createFighterState("test-user-2", "User2", bot2, null);

      const battle = createBattle("channel1", fighter1);
      acceptChallenge(battle, fighter2);
      setFighterStance(battle, "test-user-1", "aggressive");
      setFighterStance(battle, "test-user-2", "defensive");

      setFighterAction(battle, "test-user-1", "Strike");
      setFighterAction(battle, "test-user-2", "Defend");

      expect(battle.redFighter.selectedAction).toBe("Strike");
      expect(battle.blueFighter?.selectedAction).toBe("Defend");
    });
  });

  describe("recordRoundResult", () => {
    it("should record round result and advance round", () => {
      const bot1 = createMockBot(1, "Bot1");
      const bot2 = createMockBot(2, "Bot2");
      const fighter1 = createFighterState("test-user-1", "User1", bot1, null);
      const fighter2 = createFighterState("test-user-2", "User2", bot2, null);

      const battle = createBattle("channel1", fighter1);
      acceptChallenge(battle, fighter2);
      setFighterStance(battle, "test-user-1", "aggressive");
      setFighterStance(battle, "test-user-2", "defensive");

      const result = {
        round: 1,
        redAction: "Strike",
        blueAction: "Defend",
        redDamageDealt: 20,
        blueDamageDealt: 15,
        narrative: "The battle rages!",
        criticalHit: false,
      };

      recordRoundResult(battle, result);

      expect(battle.roundLog.length).toBe(1);
      expect(battle.round).toBe(2);
      expect(battle.redFighter.selectedAction).toBeNull();
      expect(battle.blueFighter?.selectedAction).toBeNull();
    });

    it("should end battle when fighter HP reaches 0", () => {
      const bot1 = createMockBot(1, "Bot1");
      const bot2 = createMockBot(2, "Bot2");
      const fighter1 = createFighterState("test-user-1", "User1", bot1, null);
      const fighter2 = createFighterState("test-user-2", "User2", bot2, null);

      const battle = createBattle("channel1", fighter1);
      acceptChallenge(battle, fighter2);
      setFighterStance(battle, "test-user-1", "aggressive");
      setFighterStance(battle, "test-user-2", "defensive");

      // Set blue fighter HP to 0
      if (battle.blueFighter) {
        battle.blueFighter.hp = 0;
      }

      recordRoundResult(battle, {
        round: 1,
        redAction: "Strike",
        blueAction: "Defend",
        redDamageDealt: 100,
        blueDamageDealt: 0,
        narrative: "Knockout!",
        criticalHit: true,
      });

      expect(battle.phase).toBe("finished");
    });
  });

  describe("getWinner", () => {
    it("should return winner based on HP", () => {
      const bot1 = createMockBot(1, "Bot1");
      const bot2 = createMockBot(2, "Bot2");
      const fighter1 = createFighterState("test-user-1", "User1", bot1, null);
      const fighter2 = createFighterState("test-user-2", "User2", bot2, null);

      const battle = createBattle("channel1", fighter1);
      acceptChallenge(battle, fighter2);
      battle.phase = "finished";

      fighter1.hp = 50;
      fighter2.hp = 0;

      const winner = getWinner(battle);
      expect(winner).toBe(fighter1);
    });
  });

  describe("isEpicVictory", () => {
    it("should return true for 5+ round battles", () => {
      const bot1 = createMockBot(1, "Bot1");
      const bot2 = createMockBot(2, "Bot2");
      const fighter1 = createFighterState("test-user-1", "User1", bot1, null);
      const fighter2 = createFighterState("test-user-2", "User2", bot2, null);

      const battle = createBattle("channel1", fighter1);
      acceptChallenge(battle, fighter2);
      battle.phase = "finished";
      battle.round = 5;
      fighter1.hp = 20;
      fighter2.hp = 0;

      expect(isEpicVictory(battle)).toBe(true);
    });

    it("should return true for 100% crowd energy", () => {
      const bot1 = createMockBot(1, "Bot1");
      const bot2 = createMockBot(2, "Bot2");
      const fighter1 = createFighterState("test-user-1", "User1", bot1, null);
      const fighter2 = createFighterState("test-user-2", "User2", bot2, null);

      const battle = createBattle("channel1", fighter1);
      acceptChallenge(battle, fighter2);
      battle.phase = "finished";
      battle.round = 3;
      battle.crowdEnergy = 100;
      fighter1.hp = 50;
      fighter2.hp = 0;

      expect(isEpicVictory(battle)).toBe(true);
    });

    it("should return true for close victory (<10 HP)", () => {
      const bot1 = createMockBot(1, "Bot1");
      const bot2 = createMockBot(2, "Bot2");
      const fighter1 = createFighterState("test-user-1", "User1", bot1, null);
      const fighter2 = createFighterState("test-user-2", "User2", bot2, null);

      const battle = createBattle("channel1", fighter1);
      acceptChallenge(battle, fighter2);
      battle.phase = "finished";
      battle.round = 3;
      fighter1.hp = 5;
      fighter2.hp = 0;

      expect(isEpicVictory(battle)).toBe(true);
    });
  });

  describe("forfeitBattle", () => {
    it("should set forfeiting player HP to 0 and end battle", () => {
      const bot1 = createMockBot(1, "Bot1");
      const bot2 = createMockBot(2, "Bot2");
      const fighter1 = createFighterState("test-user-1", "User1", bot1, null);
      const fighter2 = createFighterState("test-user-2", "User2", bot2, null);

      const battle = createBattle("channel1", fighter1);
      acceptChallenge(battle, fighter2);

      const result = forfeitBattle(battle, "test-user-1");

      expect(result).toBe(true);
      expect(battle.redFighter.hp).toBe(0);
      expect(battle.phase).toBe("finished");
    });
  });

  describe("addCrowdEnergy", () => {
    it("should add energy up to 100", () => {
      const bot = createMockBot(1, "Bot");
      const fighter = createFighterState("test-user-1", "User", bot, null);
      const battle = createBattle("channel1", fighter);

      addCrowdEnergy(battle, 50);
      expect(battle.crowdEnergy).toBe(50);

      addCrowdEnergy(battle, 60);
      expect(battle.crowdEnergy).toBe(100);
    });
  });

  describe("addPendingSpectator", () => {
    it("should add user to pending spectators", () => {
      const bot = createMockBot(1, "Bot");
      const fighter = createFighterState("test-user-1", "User", bot, null);
      const battle = createBattle("channel1", fighter);

      addPendingSpectator(battle, "spectator1");
      addPendingSpectator(battle, "spectator2");

      expect(battle.pendingSpectators.size).toBe(2);
      expect(battle.pendingSpectators.has("spectator1")).toBe(true);
      expect(battle.pendingSpectators.has("spectator2")).toBe(true);
    });
  });

  describe("activateSpectators", () => {
    it("should move pending spectators to active spectators", () => {
      const bot = createMockBot(1, "Bot");
      const fighter = createFighterState("test-user-1", "User", bot, null);
      const battle = createBattle("channel1", fighter);

      addPendingSpectator(battle, "spectator1");
      addPendingSpectator(battle, "spectator2");

      expect(battle.pendingSpectators.size).toBe(2);
      expect(battle.spectators.size).toBe(0);

      activateSpectators(battle);

      expect(battle.pendingSpectators.size).toBe(0);
      expect(battle.spectators.size).toBe(2);
      expect(battle.spectators.has("spectator1")).toBe(true);
      expect(battle.spectators.has("spectator2")).toBe(true);
    });

    it("should initialize spectator state correctly", () => {
      const bot = createMockBot(1, "Bot");
      const fighter = createFighterState("test-user-1", "User", bot, null);
      const battle = createBattle("channel1", fighter);

      addPendingSpectator(battle, "spectator1");
      activateSpectators(battle);

      const spectator = battle.spectators.get("spectator1");
      expect(spectator).toBeDefined();
      expect(spectator?.odwerId).toBe("spectator1");
      expect(spectator?.cheeredFor).toBeNull();
      expect(spectator?.lastAction).toBeGreaterThan(0);
    });
  });

  describe("cleanupBattle", () => {
    it("should remove battle and user mappings", () => {
      const bot = createMockBot(1, "Bot");
      const fighter = createFighterState("test-user-1", "User", bot, null);
      const battle = createBattle("channel1", fighter);
      const battleId = battle.id;

      cleanupBattle(battleId);

      expect(getBattle(battleId)).toBeUndefined();
      expect(isUserInBattle("test-user-1")).toBe(false);
    });
  });
});
