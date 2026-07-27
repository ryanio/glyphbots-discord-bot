/**
 * Rate Limit Tests
 *
 * Tests for playground user action rate limiting.
 */

import {
  canUserPerformAction,
  formatTimeRemaining,
  getActionTimeRemaining,
  recordUserAction,
} from "../../src/playground/rate-limit";

describe("rate-limit", () => {
  const _TEST_USER_ID = "test_user_123";
  const TEST_ACTION_TYPE = "request_spotlight" as const;

  beforeEach(() => {
    // Clear any existing state by using a unique user ID per test
    // In a real scenario, we'd want to clear the store, but since it's a singleton
    // we'll use unique user IDs for each test
  });

  describe("canUserPerformAction", () => {
    it("should allow action when user has no previous actions", async () => {
      const uniqueUserId = `user_${Date.now()}_${Math.random()}`;
      const canPerform = await canUserPerformAction(
        uniqueUserId,
        TEST_ACTION_TYPE
      );

      expect(canPerform).toBe(true);
    });

    it("should allow action when 6 hours have passed", async () => {
      const uniqueUserId = `user_${Date.now()}_${Math.random()}`;

      // Record an action
      await recordUserAction(uniqueUserId, TEST_ACTION_TYPE);

      // Mock time to be 6 hours and 1 minute later
      const originalDateNow = Date.now;
      const mockTime = originalDateNow() + 6 * 60 * 60 * 1000 + 60 * 1000;
      Date.now = jest.fn(() => mockTime);

      const canPerform = await canUserPerformAction(
        uniqueUserId,
        TEST_ACTION_TYPE
      );

      expect(canPerform).toBe(true);

      // Restore original Date.now
      Date.now = originalDateNow;
    });

    it("should block action when less than 6 hours have passed", async () => {
      const uniqueUserId = `user_${Date.now()}_${Math.random()}`;

      // Record an action
      await recordUserAction(uniqueUserId, TEST_ACTION_TYPE);

      // Mock time to be 5 hours later (still within rate limit)
      const originalDateNow = Date.now;
      const mockTime = originalDateNow() + 5 * 60 * 60 * 1000;
      Date.now = jest.fn(() => mockTime);

      const canPerform = await canUserPerformAction(
        uniqueUserId,
        TEST_ACTION_TYPE
      );

      expect(canPerform).toBe(false);

      // Restore original Date.now
      Date.now = originalDateNow;
    });

    it("should allow different action types independently", async () => {
      const uniqueUserId = `user_${Date.now()}_${Math.random()}`;

      // Record one action type
      await recordUserAction(uniqueUserId, "request_spotlight");

      // Should be able to perform a different action type
      const canPerform = await canUserPerformAction(
        uniqueUserId,
        "request_discovery"
      );

      expect(canPerform).toBe(true);
    });

    it("should block same action type after recording", async () => {
      const uniqueUserId = `user_${Date.now()}_${Math.random()}`;

      // Record an action
      await recordUserAction(uniqueUserId, TEST_ACTION_TYPE);

      // Should not be able to perform same action immediately
      const canPerform = await canUserPerformAction(
        uniqueUserId,
        TEST_ACTION_TYPE
      );

      expect(canPerform).toBe(false);
    });
  });

  describe("recordUserAction", () => {
    it("should record action successfully", async () => {
      const uniqueUserId = `user_${Date.now()}_${Math.random()}`;

      await recordUserAction(uniqueUserId, TEST_ACTION_TYPE);

      // Verify it was recorded by checking if action is blocked
      const canPerform = await canUserPerformAction(
        uniqueUserId,
        TEST_ACTION_TYPE
      );
      expect(canPerform).toBe(false);
    });

    it("should record multiple action types for same user", async () => {
      const uniqueUserId = `user_${Date.now()}_${Math.random()}`;

      await recordUserAction(uniqueUserId, "request_spotlight");
      await recordUserAction(uniqueUserId, "request_discovery");
      await recordUserAction(uniqueUserId, "request_encounter");

      // All should be blocked
      expect(
        await canUserPerformAction(uniqueUserId, "request_spotlight")
      ).toBe(false);
      expect(
        await canUserPerformAction(uniqueUserId, "request_discovery")
      ).toBe(false);
      expect(
        await canUserPerformAction(uniqueUserId, "request_encounter")
      ).toBe(false);
    });
  });

  describe("getActionTimeRemaining", () => {
    it("should return 0 when user has no previous action", async () => {
      const uniqueUserId = `user_${Date.now()}_${Math.random()}`;

      const timeRemaining = await getActionTimeRemaining(
        uniqueUserId,
        TEST_ACTION_TYPE
      );

      expect(timeRemaining).toBe(0);
    });

    it("should return time remaining when action was recently recorded", async () => {
      const uniqueUserId = `user_${Date.now()}_${Math.random()}`;
      const startTime = Date.now();

      await recordUserAction(uniqueUserId, TEST_ACTION_TYPE);

      // Mock time to be 2 hours later
      const originalDateNow = Date.now;
      const mockTime = startTime + 2 * 60 * 60 * 1000;
      Date.now = jest.fn(() => mockTime);

      const timeRemaining = await getActionTimeRemaining(
        uniqueUserId,
        TEST_ACTION_TYPE
      );

      // Should be approximately 4 hours remaining (6 hours - 2 hours)
      const expectedRemaining = 4 * 60 * 60 * 1000;
      expect(timeRemaining).toBeGreaterThan(expectedRemaining - 1000);
      expect(timeRemaining).toBeLessThan(expectedRemaining + 1000);

      // Restore original Date.now
      Date.now = originalDateNow;
    });

    it("should return 0 when 6 hours have passed", async () => {
      const uniqueUserId = `user_${Date.now()}_${Math.random()}`;
      const startTime = Date.now();

      await recordUserAction(uniqueUserId, TEST_ACTION_TYPE);

      // Mock time to be 6 hours and 1 minute later
      const originalDateNow = Date.now;
      const mockTime = startTime + 6 * 60 * 60 * 1000 + 60 * 1000;
      Date.now = jest.fn(() => mockTime);

      const timeRemaining = await getActionTimeRemaining(
        uniqueUserId,
        TEST_ACTION_TYPE
      );

      expect(timeRemaining).toBe(0);

      // Restore original Date.now
      Date.now = originalDateNow;
    });
  });

  describe("formatTimeRemaining", () => {
    it("should format hours and minutes", () => {
      const ms = 3 * 60 * 60 * 1000 + 30 * 60 * 1000; // 3h 30m
      const result = formatTimeRemaining(ms);

      expect(result).toBe("3h 30m");
    });

    it("should format only minutes when less than 1 hour", () => {
      const ms = 45 * 60 * 1000; // 45 minutes
      const result = formatTimeRemaining(ms);

      expect(result).toBe("45m");
    });

    it("should format only hours when no minutes", () => {
      const ms = 2 * 60 * 60 * 1000; // 2 hours
      const result = formatTimeRemaining(ms);

      expect(result).toBe("2h 0m");
    });

    it("should return 'now' when time is 0 or negative", () => {
      expect(formatTimeRemaining(0)).toBe("now");
      expect(formatTimeRemaining(-1000)).toBe("now");
    });

    it("should handle edge case of exactly 6 hours", () => {
      const ms = 6 * 60 * 60 * 1000; // 6 hours
      const result = formatTimeRemaining(ms);

      expect(result).toBe("6h 0m");
    });
  });

  describe("rate limit isolation", () => {
    it("should isolate rate limits between different users", async () => {
      const user1 = `user1_${Date.now()}_${Math.random()}`;
      const user2 = `user2_${Date.now()}_${Math.random()}`;

      // User 1 records an action
      await recordUserAction(user1, TEST_ACTION_TYPE);

      // User 1 should be blocked
      expect(await canUserPerformAction(user1, TEST_ACTION_TYPE)).toBe(false);

      // User 2 should not be blocked
      expect(await canUserPerformAction(user2, TEST_ACTION_TYPE)).toBe(true);
    });

    it("should isolate rate limits between different action types", async () => {
      const uniqueUserId = `user_${Date.now()}_${Math.random()}`;

      // Record one action type
      await recordUserAction(uniqueUserId, "request_spotlight");

      // Should be blocked for that type
      expect(
        await canUserPerformAction(uniqueUserId, "request_spotlight")
      ).toBe(false);

      // Should not be blocked for other types
      expect(
        await canUserPerformAction(uniqueUserId, "request_discovery")
      ).toBe(true);
      expect(
        await canUserPerformAction(uniqueUserId, "request_encounter")
      ).toBe(true);
      expect(await canUserPerformAction(uniqueUserId, "request_postcard")).toBe(
        true
      );
      expect(await canUserPerformAction(uniqueUserId, "request_recap")).toBe(
        true
      );
      expect(await canUserPerformAction(uniqueUserId, "request_help")).toBe(
        true
      );
    });
  });
});
