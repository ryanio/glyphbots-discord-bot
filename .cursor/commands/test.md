Run the test suite and verify coverage with the following steps:

## Primary Actions
1. **Run Tests**: `npm run test`
2. **CI Mode (non-interactive)**: `npm run test:ci`
3. **Coverage Report**: `npm run test:coverage` and open `coverage/lcov-report/index.html`

## Complete Testing Workflow
1. **Execute**: Run the appropriate command above
2. **Fix Failures**: Address failing tests and re-run until green
3. **Review Coverage**: Inspect HTML report for gaps on changed files
4. **Stability Check**: Re-run to ensure flakiness is resolved

## What to Check
- **All tests pass** with zero failures
- **No focused/disabled tests** (e.g., `fit`, `fdescribe`, `xit`)
- **Descriptive test names** and structure per project guidelines
- **Accessibility considerations** for UI tests where relevant

## Useful Commands
- Run a single test file: `npx jest path/to/file.test.ts`
- Run by name pattern: `npx jest -t "should post lore"`

## Project-Specific Standards
- Use Jest for unit tests
- Mock Discord.js client and API calls appropriately
- Prefer user-centric assertions; avoid implementation details
- Mock external APIs (GlyphBots, OpenRouter) in tests

## Expected Outcome
- Green test run with reliable results
- Coverage report generated and reviewed for critical changes
- Clear summary of outcomes and next steps


