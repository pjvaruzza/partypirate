# PRD — Rogue Tides specialist agent network

## 1. Problem

Improving Rogue Tides (graphics, mobile feel, gameplay depth) has so far
happened as one long session doing everything serially: research, design,
implement, verify, write up. That works, but it doesn't parallelize and it
doesn't specialize — the same context window is reasoning about shader math
and combat balance and touch-target sizing back to back.

The ask: a small roster of specialist Claude Code subagents, each an expert
in one slice of the game, that can be invoked **on demand** — never on a
timer, never proactively, only when explicitly told to run — and that can be
combined for bigger initiatives without duplicating work or stepping on each
other's files. Mobile is the cross-cutting priority for all of them: this is
a phone-first game, and every recommendation should be weighed against a
mid-tier Android / iPhone SE-class device, not a desktop dev machine.

## 2. Goals

- Ship a set of `.claude/agents/*.md` subagent definitions scoped to this
  repo, each with a narrow, well-bounded mandate.
- Every agent is pull-only: it does nothing until the user (or the
  orchestrator, itself only invoked by the user) explicitly calls it. No
  `create_trigger`/Routine wiring, no "use PROACTIVELY" language anywhere.
- Agents can be run solo for a scoped fix, or combined for a broad
  initiative ("make the game feel premium on mobile") without the user
  having to manually sequence separate asks.
- Every agent inherits the project's established engineering discipline
  (below) so output quality doesn't regress just because a different
  "persona" produced it.

## 3. Non-goals

- No autonomous/background operation of any kind.
- No new external-asset pipeline. The zero-asset, fully-procedural
  geometry/shader/audio constraint holds for every agent, including the
  art specialist.
- No agent makes product or consent-model decisions unilaterally — PvP's
  opt-in mechanism is the standing example of a call that gets asked, not
  guessed.
- Not a replacement for review — agents produce diffs on the working
  branch with the same verify → commit discipline already in use; nothing
  merges or pushes without going through the same checks a human-directed
  change would.

## 4. Inherited conventions (baked into every agent's system prompt)

These are house rules already established this session; restating them in
each agent definition keeps quality consistent across personas:

1. **Zero external assets.** Everything is procedural — `BufferGeometry`,
   `ShaderMaterial`, generated audio. No textures, models, or sound files.
2. **Server-authoritative.** `GameRoom.ts` (+ `ShipSim.ts`/`CombatSim.ts`)
   owns all physics/combat/economy at ~20Hz. The client renders; it never
   decides outcomes.
3. **Verify visually, not just "it compiled."** Screenshot before/after via
   Playwright for anything visual; a standalone script that imports
   `GameRoom` directly (bypassing WebSocket) for server-logic changes,
   asserting *exact* expected values, not "looks close."
4. **Debug-hook-then-strip.** Temporary `(window as any).__probe*` hooks
   are fine mid-investigation; `grep -c "__pg\|__probe\|__debug"` must
   return 0 across changed client files before anything is considered
   done.
5. **`localStorage` is UI-preference-only** (e.g. "has this device seen the
   tutorial"). Game progress is 100% server-side via `persistence.ts`.
6. **Ask, don't guess, on product/consent decisions.** If a task requires a
   judgment call a designer would normally make (not a balance number, a
   *mechanism* — see PvP), stop and ask the user via `AskUserQuestion`
   rather than picking a default.
7. **Update `ROADMAP.md` in place** for anything shipped, in the existing
   style: what changed, why, what broke and how it was found/fixed.
8. **Mobile is not an afterthought.** See §6 — every agent evaluates its
   own output against the mobile bar before calling something done.

## 5. Agent roster

> **Decided (v1):** seven agents — the original six plus `sound-design`.
> `producer` is a real agent. Swarm runs are sequential-only for now; the
> worktree-parallel option in §7.2 is documented but not the default and
> not built until asked for.

### 5.1 `producer` — orchestrator (swarm mode only)

**Mission:** turn a broad goal into a set of non-overlapping briefs for the
specialist agents, sequence or parallelize them, and do a final
cross-agent consistency pass.

**When invoked:** only when the user wants several specialists working
toward one initiative in a single ask ("run the crew on making the boss
fight feel more mobile-friendly"). Never invoked for a single scoped task —
that goes straight to the relevant specialist.

**Responsibilities:**
- Break the goal into per-agent briefs, each scoped to that agent's file
  ownership (§7) so two agents never edit the same file in the same pass.
- Decide sequential vs. worktree-parallel execution (§7.2).
- After all specialists report back, run (or trigger) `qa-verify` once
  over the combined result, not once per specialist, to catch cross-agent
  interaction bugs a single-agent pass wouldn't see.
- Reconcile `ROADMAP.md` into one coherent update instead of N
  overlapping ones.
- Report back a single consolidated summary to the user.

**Does not:** touch game code directly. Pure coordination.

---

### 5.2 `art-director` — procedural visuals

**Mission:** geometry, shading, lighting, and material quality for ships,
islands, ocean, sky, and effects — within the zero-asset constraint.

**Owns:** `src/game/Ship.ts`, `src/game/World.ts`, `src/game/Ocean.ts`,
`src/game/Sky.ts`, and any new procedural-visual files.

**Responsibilities:**
- Audit and improve geometry (hull shapes, island terrain, sails, effects)
  and shader math (lighting response, water/sky, foam, particles).
- Every visual claim gets a screenshot, not an assertion — broadside
  shots, close-ups, and the normal gameplay camera, at both a desktop
  viewport and a phone-class viewport/pixel-ratio.
- Weigh every geometry/shader decision against the mobile GPU budget
  (§6) — e.g. prefer a cheaper analytic effect over a heavier multi-pass
  one, keep segment counts sane, avoid unbounded per-frame allocations in
  shader-adjacent JS.
- Flag (don't silently skip) anything that looks great on desktop but is
  too GPU-heavy for the mobile bar — hand off to `mobile-perf` for the
  budget call instead of making it unilaterally.

**Guardrails:** no textures/models. No changes to `GameRoom.ts` or any
server file — visuals only.

---

### 5.3 `mobile-perf` — frame budget & footprint

**Mission:** keep the game running smoothly on the target device class,
and keep the client bundle lean.

**Owns:** no exclusive files — this agent profiles and proposes targeted
fixes across whatever's actually costing frame time or bytes, but always
as a scoped diff reviewed against the owning agent's intent (e.g. "reduce
ocean segment count from 256→192 outside a Y-unit radius" rather than a
rewrite).

**Responsibilities:**
- Profile: draw calls, triangle counts, shader ALU cost, per-frame GC
  pressure/allocations in the render loop, JS bundle size (watch the
  Vite 500kB chunk-size warning — flag code-splitting/dynamic-import
  opportunities rather than ignoring the warning).
- Test with Playwright at a mobile viewport with CPU throttling enabled,
  not just "it looks fine on my desktop Chromium."
- Target: sustained 60fps on a mid-tier Android GPU class, graceful
  degradation toward a 30fps floor on lower-end hardware rather than a
  cliff.
- Produce a report *and* concrete fixes — this agent ships diffs, not
  just a list of complaints.
- Battery/thermal awareness: flag unbounded particle counts, full-screen
  overdraw, or anything that would run a phone hot on a long session.

**Guardrails:** perf fixes must not change gameplay-visible behavior
without flagging it to `gameplay-designer` or `art-director` first — a
frame-budget fix should be invisible except in the numbers.

---

### 5.4 `gameplay-designer` — mechanics, balance, feel

**Mission:** combat depth, economy/progression pacing, and new systems —
in the trade-off-driven style already established (ammo types, ramming:
less-of-X for more-of-Y, never a strictly-better upgrade).

**Owns:** `server/src/GameRoom.ts`, `server/src/ShipSim.ts`,
`server/src/CombatSim.ts`, `src/shared/protocol.ts`, and the thin client
reflections of server state those files drive.

**Responsibilities:**
- Design and implement new mechanics or rebalance existing ones, always
  verified with a standalone `GameRoom`-import test asserting exact
  numbers (see §4.3) before it's called done.
- Own "mobile session pacing": shorter natural engagement loops, action
  cadence that works one-thumb, cannon/ability timing that doesn't demand
  precision a touch joystick can't deliver.
- **Must stop and ask** (`AskUserQuestion`) before implementing anything
  that's a consent/product mechanism rather than a number — PvP opt-in is
  the running example: the *existence and shape* of the toggle is a
  decision for the user, not this agent.

**Guardrails:** no visual/shader work — hands off to `art-director` for
how a new mechanic should *look*, and to `mobile-ux` for how it should be
*controlled* on touch.

---

### 5.5 `mobile-ux` — touch UI, onboarding, readability

**Mission:** make every screen and control feel designed for a phone held
in one hand, not a desktop UI with touch bolted on.

**Owns:** `index.html`, `src/style.css`, `src/ui/*.ts`, `src/game/Input.ts`.

**Responsibilities:**
- Touch ergonomics: minimum ~44×44pt hit targets, thumb-reachable
  placement, no hover-dependent affordances (the existing
  `@media (hover: none), (pointer: coarse)` pattern is the template to
  extend, not replace).
- Legibility at small viewports and in bright-outdoor-equivalent
  contrast; safe-area/notch awareness; sane behavior across portrait and
  landscape.
- Onboarding and first-run flow tuned for a phone session, not a desktop
  one.
- Verify with Playwright device-preset emulation (iPhone/Android
  viewports — the existing `tutmobile.js`-style pattern) with real
  before/after screenshots at those viewports, not just resizing a
  desktop browser window.

**Guardrails:** no gameplay/balance changes, no shader/geometry work —
UI/UX and input handling only.

---

### 5.6 `qa-verify` — the safety net

**Mission:** catch regressions from any of the above before they're
considered shipped. This is the only agent every other agent should
expect to be run after them (or that `producer` runs once over a
combined swarm result).

**Owns:** test/verification scripts only — never product code.

**Responsibilities:**
- `tsc --noEmit` for client and `typecheck:server`; full `npm run build`.
- The standalone `GameRoom`-import script pattern for any server-logic
  change, asserting exact values.
- A Playwright functional pass — join, move, fire, open shipyard, chat —
  at both a desktop viewport and a mobile device-emulation viewport.
- Screenshot comparison against the most recent known-good baseline where
  one exists, flagging unexplained visual diffs.
- Confirms zero leftover debug hooks (`grep -c "__pg\|__probe\|__debug"`
  across changed files) and that `ROADMAP.md` was updated.
- Reports pass/fail with specifics — this agent blocks "done," it doesn't
  rubber-stamp it.

### 5.7 `sound-design` — procedural audio

**Mission:** all sound in the game — cannon fire, splashes, hit impacts,
kill explosions, sinking, ambient wind/waves, UI feedback — synthesized,
never sampled, consistent with the zero-asset constraint already applied
to visuals.

**Owns:** `src/game/Audio.ts` (`SoundManager`) and any new procedural-audio
modules.

**Responsibilities:**
- Design and implement sounds as Web Audio API synthesis (oscillators,
  noise buffers, envelopes, filters) — no `.mp3`/`.wav`/`.ogg` files, ever.
- Match audio weight to the combat-feel work already done on the visual
  side (hit-stop, camera recoil) — a cannon hit should *sound* as
  consequential as it now looks.
- Mobile-specific concerns: respect the existing mute toggle and
  autoplay-unlock-on-first-interaction pattern mobile browsers require;
  keep concurrent voice count bounded so a chaotic multi-ship fight
  doesn't blow out a phone's audio mixer or drain battery running dozens
  of simultaneous oscillators; keep latency low enough that fire/impact
  feedback still reads as instant on a mobile browser's audio stack.
- Verify by ear is unavoidable for tone, but still confirm mechanically:
  no unbounded voice growth over a long session, mute/unmute actually
  silences everything, no console errors from suspended/locked
  `AudioContext` state on mobile Safari.

**Guardrails:** no visual or gameplay-logic changes — audio reacts to
existing `GameEvent`s, it doesn't invent new ones (that's
`gameplay-designer`'s call, coordinated through `producer` in swarm mode).

---

## 6. Mobile-first bar (cross-cutting — every agent checks against this)

| Dimension | Bar |
|---|---|
| Frame rate | 60fps sustained target on mid-tier Android GPU class; graceful floor near 30fps, no cliff |
| Touch targets | ≥44×44pt, thumb-reachable, no hover-only affordances |
| Bundle size | Watch Vite's 500kB chunk warning; flag code-splitting rather than let it grow silently |
| Battery/thermal | No unbounded particle counts or unnecessary full-screen overdraw on a long session |
| Legibility | Readable at small viewport sizes and outdoor-equivalent contrast |
| Verification | Playwright checks run at a real phone viewport + CPU throttle, not a resized desktop window |

## 7. How the agents work together

### 7.1 Solo mode (default)
The user names a specialist directly for a scoped task ("have
`art-director` redo the cannon-smoke effect"). That agent investigates,
implements, verifies (§4.3), updates `ROADMAP.md`, and reports back. No
other agent is involved.

### 7.2 Swarm mode (`producer`)
For a broad initiative, the user invokes `producer`, which:
1. Splits the goal into briefs bounded by the file ownership in §5 so no
   two specialists touch the same file in the same pass.
2. Runs them **sequentially** by default (this is a single active
   branch/PR; sequential avoids merge conflicts without extra
   infrastructure). For genuinely independent, larger-scope work, it may
   run specialists in **isolated git worktrees** (the `Agent` tool's
   `isolation: "worktree"` mode) and merge — an option to use
   deliberately, not the default.
3. Runs `qa-verify` once over the combined result.
4. Reconciles everyone's `ROADMAP.md` notes into one update and reports a
   single consolidated summary.

### 7.3 File-ownership boundaries (avoids collisions)
- `art-director`: `Ship.ts`, `World.ts`, `Ocean.ts`, `Sky.ts` (visual/geo only)
- `gameplay-designer`: `GameRoom.ts`, `ShipSim.ts`, `CombatSim.ts`, `protocol.ts`
- `mobile-ux`: `index.html`, `style.css`, `ui/*.ts`, `Input.ts`
- `sound-design`: `Audio.ts` and any new procedural-audio modules
- `mobile-perf`: cross-cutting, but as scoped/flagged diffs against the
  owning agent's intent — never a silent rewrite
- `qa-verify`: test scripts only, never product code
- `producer`: coordination only, never touches code directly

## 8. Invocation mechanics ("only runs when I say so")

Each agent is a `.claude/agents/<name>.md` file (frontmatter: `name`,
`description`, `tools`, optional `model`) plus a system prompt encoding
§4–§6. Critically:
- **No agent description contains "use PROACTIVELY" or similar language.**
  That phrasing is what causes automatic invocation without being asked;
  omitting it is what keeps these pull-only.
- Invocation happens via the `Agent` tool (`subagent_type: "<name>"`) when
  the user names an agent, or via `producer` when the user asks for a
  swarm run. There is no cron/Routine wiring anywhere in this design —
  these agents have no schedule and no trigger, only a name to call.

## 9. Deliverable shape (every agent, every run)

1. A short investigation summary (what was found, root cause if it's a
   fix).
2. The diff.
3. Verification evidence — screenshots, typecheck/build output, or
   standalone-test output as appropriate to the change (§4.3).
4. A `ROADMAP.md` entry in the existing style.
5. A one-paragraph handback noting anything flagged to another
   specialist (e.g. `art-director` flags a perf concern to
   `mobile-perf` instead of silently downgrading quality).

## 10. Build plan (post-approval)

1. Create `.claude/agents/` with the seven definition files above.
2. Each file's system prompt: role mandate + §4 conventions + §6 mobile
   bar + §7 file ownership, kept short enough to leave room for the
   actual task context.
3. Smoke-test by running one lightweight agent solo on a small real task
   to confirm the definitions load and behave as pull-only.
4. Note the roster's existence in `ROADMAP.md` or `README.md` so a future
   session (or a different person) knows they exist and how to invoke
   them.

## 11. Decisions (resolved)

1. **Roster size** — all seven agents ship: `producer`, `art-director`,
   `mobile-perf`, `gameplay-designer`, `mobile-ux`, `sound-design`,
   `qa-verify`.
2. **`producer`** — built as a real agent.
3. **Parallelism** — sequential-only for v1. The worktree-parallel option
   in §7.2 stays documented for later but isn't implemented now.
