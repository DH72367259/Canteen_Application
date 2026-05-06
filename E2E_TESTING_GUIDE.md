# E2E Testing Guide

This guide explains how to run the E2E tests locally using Playwright.

## Prerequisites

1. **Node.js 18+** installed
2. **A Supabase Project** (cloud or local)
3. **Environment Variables** configured in `.env.local`

## Setup

### 1. Create `.env.local` file

Copy the `.env.example` file and fill in your Supabase credentials:

```bash
cp .env.example .env.local
```

Then edit `.env.local` with your actual values:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 2. Set Up Database Schema

If this is a fresh Supabase project, run the schema setup:

```bash
# In Supabase Dashboard → SQL Editor, paste the contents of:
cat supabase/schema.sql
```

### 3. Clean Database (Optional)

Before running tests, clean the database to remove test data:

```bash
npm run test:e2e:init
```

This will:
- Delete all test orders and users
- Reset bins to free state
- Keep whitelisted accounts (admin@noqx.test, canteen1@noqx.test, etc.)

## Running Tests

### Option 1: Full E2E Suite (with init & cleanup)

```bash
npm run test:e2e:full
```

This will:
1. Clean the database
2. Install Playwright browsers
3. Start the dev server
4. Run all Playwright tests
5. Clean up test data

### Option 2: Just Run Tests

```bash
# First, start the dev server in one terminal:
npm run dev

# In another terminal, run tests:
npm run test:e2e:browser
```

### Option 3: Run Specific Test File

```bash
# Run only the feature updates tests
npx playwright test tests/e2e-browser/feature-updates.spec.ts

# Run with headed mode (see browser)
npx playwright test tests/e2e-browser/feature-updates.spec.ts --headed

# Run with debug mode (step through)
npx playwright test tests/e2e-browser/feature-updates.spec.ts --debug
```

## Test Coverage

The `feature-updates.spec.ts` file includes tests for:

1. **Slot Selection UI**
   - Verifies slot selector is NOT visible on menu page
   - Verifies slot selector IS visible on cart/checkout page

2. **30-Second Cancellation Timer**
   - Creates an order and checks cancel button
   - Verifies timer countdown is displayed
   - Validates button disables after timer expires

3. **Per-Item Quantity Limits**
   - Tests that students cannot add more than 7 of same item
   - Validates error message for exceeded limits

4. **Max Bins Dropdown**
   - Verifies vendor can select bins from 10-60
   - Tests dropdown has correct options

5. **Real-Time Bin Availability**
   - Checks 2-second polling updates
   - Verifies UI updates without excessive flickering

6. **Worker Dashboard UI**
   - Tests tab spacing and sizing improvements
   - Verifies tabs are properly visible and clickable

7. **Multi-Canteen Ordering**
   - Student can place orders from multiple canteens
   - Each order is independent

## Debugging Failed Tests

### View Test Report

After tests run, view the HTML report:

```bash
npx playwright show-report
```

### Check Logs

```bash
# If dev server fails to start:
cat /tmp/dev.log

# Playwright trace for failed tests:
npx playwright show-trace trace.zip
```

### Screenshots of Failed Tests

Failed tests automatically save screenshots to:
```
test-results/
└── feature-updates.spec.ts-chromium/
    └── (test-name)/
        └── test-failed-1.png
```

## Troubleshooting

### "Connection refused" / Server not starting

```bash
# Make sure no process is using port 3000:
lsof -i :3000
kill -9 <PID>

# Then try again:
npm run dev
```

### "Authentication failed"

- Verify `.env.local` has correct Supabase credentials
- Make sure SUPABASE_SERVICE_ROLE_KEY is the **service role key** (not anon key)
- Check that email auth is enabled in Supabase Dashboard → Authentication

### "Database schema not found"

Run the schema setup in Supabase Dashboard SQL Editor:
```bash
cat supabase/schema.sql | pbcopy  # macOS
cat supabase/schema.sql | xclip   # Linux
```

Then paste in the SQL Editor and execute.

### Flaky Tests

Some tests may fail intermittently due to timing:

```bash
# Run with more retries:
npx playwright test --retries=3

# Run serial (slower but more stable):
npx playwright test --workers=1
```

## CI/CD Integration

Tests run automatically on every push to `main` and on pull requests via GitHub Actions.

To skip E2E tests in a commit (emergency hotfix):
```bash
git commit -m "fix: critical bug [skip-e2e]"
```

## Adding New Tests

1. Create test in `tests/e2e-browser/your-feature.spec.ts`
2. Import helpers from `_helpers.ts`:
   ```typescript
   import { loginViaPasswordTab, provisionStudent, deleteUser } from "./_helpers";
   ```
3. Use Playwright's `test()` function with setup/teardown:
   ```typescript
   test("your test", async ({ page }) => {
     // Your test code
   });
   ```
4. Run locally to verify before committing

## Resources

- [Playwright Documentation](https://playwright.dev)
- [Playwright API Reference](https://playwright.dev/docs/api/class-playwright)
- [Supabase Documentation](https://supabase.com/docs)
- [Next.js Testing](https://nextjs.org/docs/testing)
