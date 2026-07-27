import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Several suites reach for `mockImplementation` or `spyOn` and a restore
    // written after the assertions never runs when an assertion fails, so a
    // stubbed `fetch` or `Math.random` leaks into every test after the first
    // failure. Restoring between tests makes a failure local to the test that
    // caused it.
    restoreMocks: true,
  },
});
