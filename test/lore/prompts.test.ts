import {
  buildUserPrompt,
  getNextStyle,
  NARRATIVE_STYLES,
} from "../../src/lore/prompts";
import { createLoreContext, REAL_BOT, REAL_BOT_STORY } from "../fixtures";

describe("Lore Prompts", () => {
  describe("NARRATIVE_STYLES", () => {
    it("should have multiple styles for variety", () => {
      expect(NARRATIVE_STYLES.length).toBeGreaterThanOrEqual(3);
    });

    it("should have required properties for each style", () => {
      for (const style of NARRATIVE_STYLES) {
        expect(style.name).toBeTruthy();
        expect(style.systemPrompt).toBeTruthy();
        expect(style.userSuffix).toBeTruthy();
      }
    });

    it("should have unique names", () => {
      const names = NARRATIVE_STYLES.map((s) => s.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });
  });

  describe("getNextStyle", () => {
    it("should return a valid style", () => {
      const style = getNextStyle();
      expect(NARRATIVE_STYLES).toContainEqual(style);
    });

    it("should rotate through styles", () => {
      const seenStyles = new Set<string>();

      // Get enough styles to see rotation
      for (let i = 0; i < NARRATIVE_STYLES.length * 2; i++) {
        const style = getNextStyle();
        seenStyles.add(style.name);
      }

      // Should have seen all styles
      expect(seenStyles.size).toBe(NARRATIVE_STYLES.length);
    });
  });

  describe("buildUserPrompt", () => {
    const style = NARRATIVE_STYLES[0];

    it("should include bot name and artifact title", () => {
      const context = createLoreContext();

      const prompt = buildUserPrompt(context, style);

      expect(prompt).toContain(context.bot.name);
      expect(prompt).toContain(context.artifact.title);
    });

    it("should include traits when available", () => {
      const context = createLoreContext({
        bot: REAL_BOT,
      });

      const prompt = buildUserPrompt(context, style);

      expect(prompt).toContain("Traits:");
    });

    it("should include story context when available", () => {
      const context = createLoreContext({
        bot: REAL_BOT,
        story: REAL_BOT_STORY,
      });

      const prompt = buildUserPrompt(context, style);

      expect(prompt).toContain("Role:");
      expect(prompt).toContain("Faction:");
      expect(prompt).toContain("Mission:");
      expect(prompt).toContain("Setting:");
    });

    it("should include abilities when available", () => {
      const context = createLoreContext({
        bot: REAL_BOT,
        story: REAL_BOT_STORY,
      });

      const prompt = buildUserPrompt(context, style);

      expect(prompt).toContain("Abilities:");
      expect(prompt).toContain("Shadow Merge");
    });

    it("should append style-specific suffix", () => {
      const context = createLoreContext();

      const prompt = buildUserPrompt(context, style);

      expect(prompt).toContain(style.userSuffix);
    });

    it("should work without story context", () => {
      const context = createLoreContext({ story: null });

      const prompt = buildUserPrompt(context, style);

      expect(prompt).toContain(context.bot.name);
      expect(prompt).not.toContain("Role:");
    });
  });
});
