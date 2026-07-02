# Sticker Phase 2 Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the completed sticker achievement system into `calm-shopping-main-new` while preserving every newer account, profile, navigation, and persistence change, then deploy and verify the Supabase schema.

**Architecture:** Treat the new directory as the base. Copy isolated sticker modules/assets/pages, then integrate only the required HTML script tags, achievement event calls, and coin-store bridge into the new files. Deploy the transactional SQL through Supabase Management API only after a read-only compatibility check.

**Tech Stack:** Native HTML/CSS/JavaScript, Node built-in test runner, Supabase JavaScript client, PostgreSQL/RLS/RPC, FastAPI/pytest.

---

### Task 1: Establish the failing merge contract

**Files:**
- Create: `tests/sticker-phase2.test.js`
- Test: `tests/sticker-phase2.test.js`

- [ ] Copy the existing phase-two contract test into the new repository.
- [ ] Run the bundled Node executable with `--test tests/sticker-phase2.test.js`.
- [ ] Verify RED is caused by missing `web/js/sticker-catalog.js` and missing sticker pages, not by a test syntax error.

### Task 2: Move isolated sticker units

**Files:**
- Create: `web/sticker.html`, `web/sticker-wall.html`
- Create: `web/css/stickers.css`, `web/css/sticker-wall.css`
- Create: `web/js/sticker-{catalog,model,store,editor,hall,achievements,reward,wall}.js`
- Create: `web/assets/stickers/*.png`, `web/assets/scenes/*.png`
- Create: `supabase/migrations/20260630_sticker_phase2.sql`

- [ ] Copy these isolated files from the completed implementation without changing the new repository's account modules.
- [ ] Run the Node test and verify catalog, ownership, queue, asset, layout, RPC-contract, and reward tests pass; integration tests should remain RED until Task 3.

### Task 3: Integrate with the newer application shell

**Files:**
- Modify: `web/index.html`
- Modify: `web/css/style.css`
- Modify: `web/js/main.js`
- Modify: `web/js/store.js`

- [ ] Replace only the old static dex block with the sticker hall; retain the new profile/settings/shortcut DOM.
- [ ] Load sticker modules before `main.js`, add the reward overlay, and append scoped sticker reward CSS.
- [ ] Add `recordStickerEvent`, `recordReportAchievement`, and `emitDecisionAchievements` to the new main flow; call them only after the corresponding report/decision persistence succeeds.
- [ ] Initialize sticker ownership/layout on auth changes and emit `daily_visit` with an ISO date event id.
- [ ] Add `applyRemoteCoins(n, silent)`, `refreshCoins()`, and `flushCoins()` to the newer store while retaining `fetchCompanionOverview` and its exports.
- [ ] Run Node tests and all JavaScript syntax checks; expected result is zero failures.

### Task 4: Browser and backend regression

**Files:**
- Verify: `web/index.html`, `web/sticker-wall.html`, `web/sticker.html`
- Verify: `backend/tests`

- [ ] Run `E:\anaconda3\python.exe -m pytest backend/tests -q`; expect 17 passing tests.
- [ ] Serve `web/` locally and use headless Chrome to assert 12 wall cards, one guest-owned card, one editor tray item, no 430px overflow, and a 393×852 desktop shell.
- [ ] Assert no browser `pageerror` events on the yard, wall, and editor pages.

### Task 5: Deploy Supabase transaction safely

**Files:**
- Read: `web/js/config.js`
- Execute: `supabase/migrations/20260630_sticker_phase2.sql`

- [ ] Parse project ref from `SUPABASE_URL` without logging URL keys or token values.
- [ ] Call Management API read-only SQL to inspect `public.user_stats` column types and current sticker objects.
- [ ] If `user_id` is UUID-compatible and `coins` numeric, submit the migration through `POST /v1/projects/{ref}/database/query`; otherwise stop before mutation.
- [ ] Query table existence, RPC signatures, seeded definition count, and RLS flags; expect five tables, four public RPCs, 12 sticker definitions, and RLS enabled.
- [ ] Remove the user-level `SUPABASE_ACCESS_TOKEN` after verification.

### Task 6: Final verification and handoff

**Files:**
- Modify: `README.md`

- [ ] Document the wall/editor routes, v2 storage behavior, migration path, and deployed status.
- [ ] Re-run Node tests, JavaScript syntax checks, pytest, and browser assertions from a clean server process.
- [ ] Report exact pass counts and any remaining limitation; do not claim live authenticated purchase testing unless a disposable test account was used.
