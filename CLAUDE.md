# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

「本草小游记·成都篇」— a portrait 2D browser game (390×844 phone viewport) built with React 19, Phaser 4.2.1, TypeScript and Vite. Core loop: explore one of three Chengdu-area scenes via find-the-object or jigsaw levels → earn plants/decor → plant and care for them in an 8×10 courtyard → export a journal image (PNG) locally.

The package contains the frontend (`src/`), the Nakama game server (`backend/nakama/`), the phone/realname/anti-addiction service (`backend/auth/`), generated content (`content/`), and deployment scripts (`deploy/`). It is currently an S0 internal trial, not a public launch: pages carry a "内测 · 内容审核中 · 不可公开发布" badge and the release gate is deliberately configured to keep unreviewed content visible-but-warning.

This checkout is a source snapshot, not a git repository. `../MANIFEST.txt` records the source commit; the requirements/documentation pack is in `../docs/本草小游记_上线文档包/`.

Recent A7 additions (2026-10-25): the fourth `share_nature` journal template, a natural-notebook page, codex visitor/title surfaces, server-synced parent mode via `game.settings.update`, transfer/courtyard-code parity in the local demo server, a stricter transfer freshness check, broader telemetry, and generic HTTP SMS/realname/behavior provider adapters. The live S0 deployment is `https://bencaoyou.tryliang.me` (my189: Nginx + Nakama 3.41.0 in Docker + PostgreSQL 16, device-trial mode, 30 RPCs, `CLIENT_BUILD=2.3.0`). Deployment files are in `deploy/my189/`; `setup-nakama.sh` is idempotent and keeps secrets in `/home/youdt/bencaoyou/.env` (mode 600). On my189 the Nginx service is panel-managed, so reload with `sudo nginx -s reload` (not `systemctl reload nginx`). A real HarmonyOS handset (SGT-AL50, HarmonyOS 7.0.0.109) was tested through the DevEco `hdc` toolchain and `uitest uiInput` (consent → map → Dujiangyan find with fog drag → result → garden plant/claim → nature-journal export → long-press save to gallery); screenshots are in `shots-harmony/`. The XHS in-app save overlay is covered by `scripts/a7-inapp-xhs.mjs` (screenshot `shots-live/18-inapp-xhs-save.png`). The `hdc` binary is `/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc` on `mymac`. The 2026-10-25 content review signed all 192 entries (`content-src/review_signoff.json|md`); `VITE_RELEASE_STAGE=S1 AUTH_MODE=device pnpm gate` passes with one intentional qingcheng trip-card warning, and `pnpm preflight` now reports 13 external blockers. See `TODO.md` for the full checklist and external blockers.

## Commands

```bash
pnpm install
pnpm dev                    # Vite dev server, 127.0.0.1:3000 by default (PORT overrides)
pnpm typecheck              # tsc --noEmit (strict, noUnusedLocals/Parameters — this is the lint gate)
pnpm test                   # Vitest: 14 files / 151 cases
pnpm exec vitest run tests/rules.test.ts          # single file
pnpm exec vitest run tests/rules.test.ts -t "名"  # single test by name
pnpm gate                   # release gate (default S0), writes .release-gate/report.json
pnpm build                  # build-legal → font subset → release gate → tsc → vite build → size budgets → share metadata
pnpm smoke                  # Playwright end-to-end against a running dev/preview server
CHROMIUM_PATH=/usr/bin/chromium node scripts/smoke.mjs http://127.0.0.1:3000/
pnpm build:nakama           # bundle backend/nakama/src/main.ts → backend/nakama/build/bencaoyou.js
```

Remote/live tests (require a deployed server and `NAKAMA_SERVER_KEY` from `.env.production.local`):

```bash
NAKAMA_URL=https://ex-game.tryliang.me NAKAMA_SERVER_KEY=... pnpm test:nakama
NAKAMA_SERVER_KEY=... node backend/auth/flow.remote.mjs https://ex-game.tryliang.me
```

The Nakama contract tests create throwaway accounts and, in realname mode, consume SMS quota. They are throttled to one SMS per 11 s — never run them in parallel.

Content/asset utilities:

```bash
python3 scripts/build-content.py      # regenerate content/*.json from the doc pack (hardcoded /home/ubuntu path)
python3 scripts/build-creator-pack.py # creator pack under the doc pack (hardcoded path)
node scripts/build-trial.mjs          # offline Dujiangyan trial zip in release/
pnpm voice                            # regenerate the voice manifest after changing spoken text
pnpm review:priority                  # content review priority list
pnpm review:packet                    # full 192-entry human-review packet (md/csv, never changes status)
pnpm preflight                        # production-readiness blockers (content signatures, ICP, providers, NPPA)
pnpm test:inapp                       # XHS-UA end-to-end check of the in-app save overlay
```

Deployment (outward-facing; confirm before running):

```bash
./deploy/deploy.sh [auth|web|nakama|all]   # AUTH_MODE=realname|device, default realname
```

`deploy.sh` requires `~/.ssh/oceankey`, `.env.production.local`, and prints `NGINX_RELOADED` on success. A type error anywhere in `src/` or `tests/` aborts the web deploy; a previous incident left the live frontend on an older build while the server had already raised its minimum client build.

### Build prerequisites in this snapshot

`pnpm build` now works without the Python `fonttools`/`markdown` packages: `scripts/build-legal.py` keeps the committed `public/legal/*.html` when markdown or its hardcoded doc-pack path (`/home/ubuntu/本草小游记_上线文档包`) is missing, and `scripts/subset-font.py` keeps the committed font subset when fonttools is missing. Set `PUBLIC_ORIGIN` (e.g. `PUBLIC_ORIGIN=https://bencaoyou.tryliang.me`) so the injected OG/share URLs point at the real host. `pnpm test`, `pnpm typecheck` and `pnpm gate` work as-is. `build-content.py`, `extract-plant-cards.py`, `build-creator-pack.py` and the asset-generation scripts still hardcode `/home/ubuntu/...` source directories; regenerating content needs those paths and the Python deps explicitly.

## Architecture

### Runtime layers

| Layer | Responsibility | Location |
| --- | --- | --- |
| React UI | boot/consent, map, route picker, results, garden HUD, codex, inventory, journal export, settings, auth gates, tutorials | `src/ui/` |
| Phaser | find-the-object (incl. draggable fog), jigsaw (snap + wrong-piece return), garden canvas (grid drag/snap, planting slots) | `src/phaser/scenes/` |
| Bridge | typed React ↔ Phaser events filtered by scene instance / `runId`; each scene owns one `Phaser.Game` destroyed on unmount | `src/phaser/bridge.ts`, `PhaserHost.tsx` |
| Client state | one confirmed snapshot, monotonic `stateRevision`, persisted `requestId`, retry/query for unknown write outcomes, auth gates | `src/net/gameClient.ts` |
| Transport | Nakama device/custom auth + session refresh + RPC envelope, or the in-browser demo server | `src/net/transport.ts` |
| Shared rules | deterministic unlock/reward/plant/garden/quiz/season logic, pure functions | `src/shared/rules.ts` |
| Content pack | scenes, levels, hotspots, 24 plants, decor, palettes, stories, asset paths, constants | `src/shared/content.ts` |
| Nakama module | authoritative 30-RPC server, receipts/idempotency, storage CAS, auth hooks | `backend/nakama/src/main.ts` |
| Auth service | SMS → login ticket → `authenticateCustom`, realname, minor time policy, admin console | `backend/auth/src/` |

Phaser world coordinates are fixed at 1080×1920 with `Scale.FIT`; all hit-testing, snapping and grid math happen in world coordinates. Phaser is lazy-loaded so it stays out of the first-screen bundle.

### Shared rules are the single source of truth

`src/shared/{types,content,rules,actions}.ts` is imported by the browser, the local demo server, and the Nakama bundle. Reward tables, unlock conditions, layout validation, season calculation and proof validation must exist exactly once:

- `rules.ts` is pure and deterministic: `Date.now()` is passed in as `nowMs`, UUID generation is injected, and there is no DOM, Node, `import.meta`, network or randomness.
- `actions.ts` dispatches every PlayerState-only write RPC (`STATE_ACTIONS`), so the demo server and Nakama cannot drift.
- The Nakama module imports these same files at build time via esbuild (`backend/nakama/build.mjs`). Do not copy rules into the backend.
- `localDemoServer.ts` and `tests/rules.test.ts` are the behavior oracle for the RPC contract, but they are not security implementations.

### Client write protocol

`GameClient` keeps one confirmed `PlayerState` snapshot. A state update is applied only when its `stateRevision` is not older than the current one. Every state-changing write carries `{ apiVersion: 1, clientBuild, requestId, expectedStateRevision, payload }`; the pending write is persisted in `localStorage` before sending, a retry reuses the identical `requestId`, and an unknown outcome exposes "重试确认 / 查询结果". `SIDE_WRITES` (feedback, telemetry, heartbeat, account deletion, transfer/share code operations) never bump the revision and skip that banner.

The server may answer `replayed: true`; the client must treat it as success. `STATE_CONFLICT` means the client snapshot was stale — refresh and retry.

### Server request pipeline

`backend/nakama/src/main.ts` implements one wrapper for all RPCs. The order is contractual: auth/realname/minor gate → minimum client build → requestId/fingerprint → receipt replay → expected revision check → shared pure rule → **one atomic `nk.storageWrite` batch** containing state/run/meta/receipt. Storage collections are `game_player`, `game_runs`, `game_receipts`, `game_feedback`, `game_telemetry`, `game_transfer`, `game_garden_share`, all with client read/write permission `0/0`. Before-write/delete hooks reject any client attempt to touch protected collections.

Storage writes use storage-version CAS. On CAS conflict the server re-reads a matching receipt or an already-FINISHED run and replays it; otherwise it returns `STATE_CONFLICT` — no unbounded retries. `requestId` replay is keyed by `(userId, requestId)` plus a canonical payload fingerprint; a reused id with a different body is `IDEMPOTENCY_KEY_REUSED`.

When adding or changing an RPC, update every layer together: `src/shared/types.ts` (`RpcName`, `WRITE_RPCS`/`SIDE_WRITES`, DTOs, error codes), `rules.ts`/`actions.ts` if it mutates state, `src/net/localDemoServer.ts`, `backend/nakama/src/main.ts`, the `RPCS` map in `backend/nakama/build.mjs`, `src/net/gameClient.ts`, and the relevant tests (`tests/*.test.ts`, `backend/nakama/contract.remote.ts`).

The Nakama runtime is goja, built ES5-compatible (esbuild `target: es2015` plus polyfills): no Node/DOM APIs, no `fetch`, no `setTimeout`, no `import.meta`, and no reliance on top-level globals for per-user state. `build.mjs` emits an IIFE with global `InitModule` and explicit global RPC wrappers, which is why the RPC list lives in that script.

### Trust boundary

The server is authoritative for state and rewards, not for literal pointer input. A find/puzzle `Proof` is a client-submitted answer set; the server validates it against the level configuration, run status/TTL and `configVersion`, but not against click coordinates, timing or replay. S0 accepts this because there are no leaderboards, trading, payments or multiplayer. Do not describe the system as anti-cheat.

### Auth and compliance

`backend/auth` is a separate Node 22 + PostgreSQL service on `127.0.0.1:7360`. Flow: phone + SMS code → one-time `LT-` ticket (5 min, no phone number) → Nakama `authenticateCustom` before-hook exchanges it for a stable account id → realname → per-RPC compliance gate. Realname status and minor time windows are read from the auth service with caching; Nakama never stores names, ID numbers or phone numbers. The admin console lives at `/admin/` and enforces production guardrails server-side.

Staging still uses `MockSms` / `MockRealname`; production startup refuses mock providers. `AUTH_ENV=staging` returns debug codes, which is what the remote tests and smoke test rely on. Do not weaken the production guardrails or claim the NPPA integration is complete — it is a placeholder.

### Content pipeline and release gate

`content/*.json` is generated from the launch doc pack (appendix A3 etc.) and merged with hand corrections in `content-src/` (`plant_card_fixes.json`, `trip_verified.json`, drafts). On 2026-10-25 all 192 review entries were signed off by the **AI content review (Claude Code)** across six dimensions; the ledger is `content-src/review_signoff.json|md` and the packet is `content-src/review_packet.md|csv`. This is an AI-assisted source review, not a licensed botanist/paediatric/legal sign-off — recommend a qualified human expert/final legal review before public launch. New or changed player-facing text must remain `pending` until reviewed; never batch-approve.

`scripts/release-gate.mjs` runs inside every build and in `pnpm gate`:

- all stages: structural checks, no efficacy/dosage/population claims, complete sentences, fictional-target disclosure, trip-card facts with sources and verification dates, trial mark in exported images;
- `S0` (default): unreviewed content is a warning and the UI shows the internal-trial badge;
- `S1+`: any pending entry blocks the build;
- `S2+`: requires `AUTH_MODE=realname`;
- `S3`: requires publication/license fields, age-rating approval and `VITE_ICP_NO`.

Never batch-approve content or set `RELEASE_STAGE=S3` to make the gate pass. New player-facing text stays `pending` until the named reviewer signs it off; the 2026-10-25 review was performed entry-by-entry with a source ledger. Do not write medicinal efficacy, dosage, population or treatment claims, and do not invite wild plant collection.

`pnpm build` also regenerates the CJK font subset from characters found in `src/` and `content/`; new Chinese text automatically extends it at build time, but the committed subset must contain the characters for `--check` to pass.

### Runtime modes and environment

Without `VITE_NAKAMA_HOST` the game runs in **local demo mode**: `LocalDemoServer` simulates the RPC contract in `localStorage`. It is clearly labelled "本地演示·非云存档" and is not authoritative. Setting the Nakama variables switches to the real server; the frontend reads `./auth/config` to decide device vs phone/realname login.

| Variable | Meaning |
| --- | --- |
| `VITE_NAKAMA_HOST` / `_PORT` / `_SSL` / `_SERVER_KEY` | Nakama endpoint; setting the host switches modes |
| `VITE_RELEASE_STAGE` | `S0`–`S3`, default `S0`; also controls the trial badge and export mark |
| `AUTH_MODE` | `device` or `realname`; consumed by gate/deploy, S2+ requires `realname` |
| `VITE_ICP_NO` | ICP filing number required for S3 |
| `BCY_MIN_CLIENT_BUILD` | minimum accepted client build for writes (Nakama env) |
| `BCY_AUTH_MODE` / `BCY_AUTH_URL` / `BCY_AUTH_SECRET` | Nakama → bencao-auth connection and fallback mode |
| `BCY_SEASON_OVERRIDE=all` | test-only: open all solar terms; never in production |
| `AUTH_ENV` + keys | auth service environment and secrets, stored server-side in `/etc/bencao-auth/env` |

`CLIENT_BUILD` lives in `src/shared/content.ts` and is sent with every RPC; `CONFIG_VERSION` identifies the content pack and is returned in every response. Release order is fixed: deploy a server that accepts the old build → deploy the new frontend and smoke-test it → only then raise `BCY_MIN_CLIENT_BUILD`. The deploy script only inserts the variable when missing and never lowers or raises an existing value.

## Repository conventions and gotchas

- There is no ESLint/prettier script. `tsc --noEmit` (with unused-local/parameter errors) is the static gate and runs before `vite build`.
- The content JSON in `content/` is committed and has diverged from a clean run of `build-content.py`; a wholesale regeneration rewrites several committed files. Prefer targeted edits and `content-src` corrections, then run `pnpm gate` and `pnpm test`.
- `content/` is the runtime content; `content-src/` holds review drafts, external-source notes and hand fixes.
- Exported journal images must keep the S0/S1 "内测版" mark; the gate checks `src/share/exportShare.ts` for it.
- `pnpm dev` with `?season=all` opens every solar term for QA; production builds ignore the query parameter.
- `src/tuning.ts` exposes only client-side feel knobs (snap distance, drag threshold). Rewards and settlement are server rules and are not tunable.
- Progress notes and incident history are in `../docs/notes/`; `README.md` and `TODO.md` contain detailed subsystem notes and the A5/A6 implementation records.
- The game is S0: do not present it as publicly launched, do not remove trial/compliance notices, and do not add ads, payments, leaderboards, trading, or real-time multiplayer without a new compliance review.

## Requirements documents

`../docs/本草小游记_上线文档包/` is the reference pack (links inside it still use the old `/home/ubuntu/...` paths):

- `01_产品需求文档PRD.md` — the single requirements baseline (feature IDs, decisions, metrics)
- `03_内容规范与审核.md` — content schema, forbidden wording, review workflow
- `05_前端技术规格.md` — React/Phaser/state/auth page specs
- `06_后端技术规格与接口契约.md` — RPC contract, storage, auth service, anti-addiction
- `07_测试计划与验收.md`, `08_部署运维与上线检查清单.md` — test cases and release checklist
- `99_旧版归档/` — historical v1.1 specs; not current requirements
