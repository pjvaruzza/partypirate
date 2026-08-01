# Roadmap — future enhancements

Ideas to pursue in later sessions, roughly ordered by priority within each
tier. Sizes are rough gut-checks (S = an hour or two, M = a session, L = multi-session).

## Tier 1 — Make combat feel great (do these first)

- [x] **Enemy broadside AI (S/M):** enemies now use the same fire-all-mounted-
  cannons loadout system as the player and steer to hold a broadside-on
  orbit at range during the `attack` state (picking whichever perpendicular
  heading is closer to avoid flip-flopping), only firing once actually abeam
  of the target. `chase`/`patrol` behavior is unchanged.
- [x] **Juice pass (S):** cannon muzzle flash, splash particles where
  cannonballs hit water, wood-splinter bursts on ship impacts, an
  explosion + debris burst when a ship sinks, screen shake on the player
  taking a hit, and a red/white hit-flash tint on any ship taking damage.
  See `src/game/Effects.ts`.
- [x] **Sound (S/M):** cannon fire, splashes, hit impacts, a descending
  "sink" sting, and a looping wind/wave ambient bed — all synthesized live
  via Web Audio (filtered noise + oscillators), no audio assets needed. See
  `src/game/Audio.ts`. Still open: wood-creaking detail layer, real music.
- [x] **Sinking animation (S):** ships now list to one side and settle
  ~2.5 units into the water over ~2.2s (with the sink explosion/sound
  firing at the moment of death) instead of vanishing instantly, for both
  enemies and the player.
- [x] **Impact/weight pass (S):** hits previously registered but didn't
  *feel* like anything — fixed with: floating damage numbers
  (`src/game/DamageNumbers.ts`, yellow for damage you deal, red for damage
  you take), a brief hit-stop freeze-frame on any impact or kill (client
  rendering-side only — scales that frame's dt down to ~8%, never delays
  input), a small camera-shake kick both when you fire and when you land a
  hit (distinct from the bigger shake for taking one), a layered low-thud
  under the hit sound for punch, and a bigger three-part kill explosion
  (debris + embers + a bright core flash). The `hit` event now carries
  `ownerId`/`damage` so the client can tell "you dealt this" from "you took
  this." (The "visuals look cheap" follow-up is addressed under the art and
  sky items in Tier 4.)

## Tier 2 — Combat depth & variety

- [x] **More powerup/ammo types (M):** four ammo types, switchable anytime
  (free, no resource pool) via the bottom-center selector or keys 1-4: round
  shot (full damage, the default), chain shot (half damage, but fouls the
  target's rigging — speed capped to 35% of top speed for 3.5s), grapeshot
  (1.6x damage at close range, 0.6x at range — `ball.age` at impact stands in
  for "how close was the target when fired," since a shotgun blast is weak
  past its spread), fire shot (0.4x initial damage, then an extra 0.7x total
  spread over 4 ticks of burn damage). Chain shot also reloads 1.3x slower —
  every type trades base damage for a situational effect, so round shot stays
  the correct default rather than something strictly worse. Burn DoT ticks
  off an integer counter (`burnTicksRemaining`), not a second duration timer
  racing the tick timer — an earlier version lost the last tick to float
  drift between two independently-decrementing timers when they landed on
  the same instant; caught by a standalone `GameRoom` test asserting the
  total burn damage came out to exactly the expected value, not "close to."
  Client renders both effects: sail darkens while disabled, hull gets a
  pulsing orange smolder while burning. Bots always fire round shot — no AI
  complexity added for ammo selection. PvP is still parked pending the
  opt-in design answer, so all of this is player-vs-bot only for now, same
  as ramming.
- [x] **Ramming (S):** driving your hull into a bot at speed (≥3.5 units/s
  relative closing speed) damages both sides, scaled by that closing speed
  (capped at 45) — reuses the same damage-number/hit-stop/shake feedback as
  cannon hits, plus a distinct, heavier wood-crunch effect and sound. Pushes
  both ships apart and bleeds their speed on contact so they don't stay
  glued together, with a 1.2s per-ship cooldown so one collision doesn't
  melt a target across several ticks. Ram kills pay out the same gold/heat/
  treasure-map rewards as a cannon kill (`killShip()` in `GameRoom.ts`,
  factored out of `resolveCombat` so both paths share it). Player-vs-bot
  only, matching the no-PvP design. Worth knowing: a bot that's already
  spotted you holds its broadside-orbit range (~28 units), so landing a ram
  on an alert enemy means actively cutting inside its turn — it lands much
  more easily on a patrolling/unaware bot, which feels intentional (a
  skill-rewarding alternative to cannons) rather than a bug.
- [x] **Named rival captains (M):** the world now periodically (every ~45s,
  35% chance, up to 2 at once) spawns a named mini-boss — six unique captains
  (Calico Jack Rackham, One-Eyed Beatrix, etc.) each with a deterministic,
  distinct hull/sail color. Tougher than a same-tier regular bot (1.6x
  health), reloads faster (0.85x) with a wider broadside-fire tolerance
  (48°), and pays 3x the gold. Sighting and defeat are both announced
  world-wide (not just to the player who lands the kill), unlike the
  quest-chain boss which only messages the hunter. No enrage phase — that
  stays the treasure-chain boss's signature.
- **Boarding (L):** at low enemy health, option to board instead of sink —
  higher risk/reward loot, maybe a quick-time or mini-minigame.

## Tier 3 — Progression & content

- [x] **Ship classes (M):** three tiers — sloop (2 base cannon slots) →
  brigantine (4 slots, 900g) → galleon (6 slots, 3000g) — each a real,
  visible hull-size jump (1x/1.3x/1.6x scale) plus a stat bonus folded into
  the existing sail/hull upgrade formulas as "free levels." One-time
  purchases in the shipyard, server-authoritative. Brigantines and galleons
  now also carry a second mast and a genuinely different hull shape (fuller
  beam, a stepped raised sterncastle), so class reads structurally rather
  than only as scale — see the art-pass entry above for detail.
- [x] **Quests/treasure maps (M/L):** sinking a bot has a 25% chance to drop
  a torn map (if you don't already have one active), revealing a glowing
  marker at a random island; sailing into range digs up 200–600 gold
  (scaling with hunts completed). Every 5th completed hunt now spawns a
  legendary boss ship near you instead — a much tougher bot (612 HP vs. a
  normal Tier-4's 180, 4 broadside cannons) with an escalating name/reward
  (1000, 1500, 2000g...) each time, rendered with a distinct black-hull/
  blood-red-sail look and 1.5x scale. Closes the original "quest chain
  building toward a legendary boss ship" idea. Bosses also fight
  differently now: faster reload (0.8x vs. a normal bot's 1.5x) and a wider
  broadside-alignment tolerance (55° vs. 35°) from the start, and a
  one-time berserker "enrage" at 35% health (reload drops to 0.45x, window
  widens to 75°) announced to the whole world — so they no longer feel like
  a reskinned regular enemy.
- [x] **Reputation/heat (M):** sinking a ship raises your "heat" (0-100,
  scaled off the gold reward — a boss kill nearly maxes it out in one hit),
  shown as an orange wanted-meter under the health bar. Heat decays slowly
  while at sea but drains fast once you're back near home port, and every
  ~12s there's a chance (proportional to how hot you are) that a hunter ship
  scaled to your heat level spawns nearby — the classic push-your-luck timer
  pushing you back toward port. Session-only, not persisted across logins.
- [x] **Early-session bot difficulty pacing (S):** audited the economy/
  progression curve specifically through a 5-15 minute mobile session lens
  (phone-first game, not an open-ended desktop sit). The standout problem:
  `spawnBotWave`/`spawnRivalCaptain` picked a difficulty tier from
  `floor(dist / 220)` off spawn distance from home port (dist ∈ [120, 870)
  on the default 900-radius world), but the tier-0 band (dist 120-220) was
  only 100 of those 750 units wide — **13.3%** of spawns. Tier-1 bots have
  more HP headroom (100 vs. round shot's 12 dmg = 9 hits to kill) than their
  reload-speed penalty gives back (bot reload 1.53s vs. player's 1.1s still
  only needs 4 hits at 18 dmg to kill a stock 60-HP sloop in ~6.1s, beating
  the player's own ~8.8s min TTK) — so a first-time player's *nearest*
  reachable fight was, ~87% of the time, one their starting ship couldn't
  realistically win, before they'd earned enough gold (2 tier-0 kills' worth,
  40g for the cheapest upgrade) to be anything but a sloop with all stats at
  0. That's a losing-fight-dominated first several minutes on exactly the
  session length this game is designed around, not a hard-but-fair one.
  Fixed by widening the tier-0 band relative to the same overall spawn
  range: extracted the duplicated inline formula into a shared
  `tierForDistance()` (`BOT_TIER_MIN_DIST = 120`, `BOT_TIER_STEP = 190`),
  giving four roughly-equal ~190-unit bands instead of one narrow one plus
  three wide ones. Tier-0 share of spawns: **13.3% → 25.3%** (exact, see
  verification below); tier-3 share correspondingly drops slightly, **28.0%
  → 24.0%** — a real trade-off, not a buff: the far edge of the map (where
  players who've already upgraded are headed anyway) gets marginally fewer
  of its toughest bots, in exchange for a new player's first few minutes
  actually being winnable most of the time instead of a coin-flip. No
  change to individual bot stats/rewards/AI, `ENEMY_SPAWN_INTERVAL`, or
  `MAX_ENEMIES` — purely a redistribution of which tier spawns where.
  Verified with a standalone `tsx` script driving a real `GameRoom`
  instance: cleared bots and called `(room as any).spawnBotWave()` 7500
  times with `Math.random` swept deterministically across `[0, 1)` (a
  multiple of the 750-unit dist span, so tier boundaries land on exact
  integer counts), reading `bot.stats.sailLevel` (which spawnBotWave sets
  equal to `tier`) as the tier of each spawn. Old-formula tier counts
  `[1000, 2200, 2200, 2100, 0]` of 7500 vs. new-formula counts
  `[1900, 1900, 1900, 1800, 0]` of 7500 — both matched a hand-derived
  expected-count array exactly, term for term, not just "close."
  `spawnRivalCaptain` shares the same `tierForDistance()` call so rival
  spawns get the same rebalance (rivals stay meaningfully tougher than a
  same-tier regular bot via `RIVAL_HEALTH_MULT`/`RIVAL_SAIL_BONUS`,
  unchanged). `npx tsc --noEmit`, `npm run typecheck:server`, and
  `npm run build` all pass clean.
- **Multiple ports / fast travel (M):** unlock a second and third shipyard
  further from spawn, eventually with fast travel between them.
- **Cosmetics (S/M):** flag design, hull paint colors, sail patterns — cheap
  to build, good personalization/monetization hook later.

## Tier 4 — Production polish

- [x] **Sky (S):** was a 2x256 canvas gradient assigned to `scene.background`,
  which three.js draws in screen space — so it never responded to view
  direction and had no sun. Now a real dome (`src/game/Sky.ts`): horizon-to-
  zenith gradient matched to the scene fog, a sun disc and scatter glow
  placed at the actual `DirectionalLight` direction, and a drifting
  procedural cloud layer. Follows the camera so it can't be sailed out of.
- [x] **Onboarding (S):** a `src/ui/Tutorial.ts` overlay covers steering/
  boost, broadsiding + ramming, the shipyard, treasure maps, heat, and chat
  — previously every one of those systems had zero in-game explanation.
  Shown automatically the first time a browser joins (tracked via a
  `localStorage` flag — a UI preference, not game progress, so it doesn't
  touch the server-authoritative save model), reopenable anytime via a ❓
  button next to mute/chat. Control hints swap between keyboard and touch
  wording via the same `(hover: none), (pointer: coarse)` media query
  already used to hide the touch controls on desktop, so the tips actually
  match the controls the player has in front of them.
- [x] **Mobile touch-target/reachability pass (S):** first dedicated
  ergonomics audit of the shipyard and ammo-selector UI added after the
  original mobile viewport review — verified with Playwright device presets
  (`devices['iPhone 8']` for the 375×667 SE-class bar the task called for,
  plus a spot-check at the old 320×568 SE and 390×664 iPhone-13-class) rather
  than a resized desktop window, so `pointer: coarse`/`hover: none` actually
  apply. Found and fixed: (1) **the Starboard cannon-placement column
  rendered fully off-screen and untappable** on every phone width tested,
  320–390px, only clearing at desktop widths — `.cannon-builder-row`'s three
  `flex: 1` columns each hit their min-content width (fixed-size +/- buttons
  + count can't shrink further) before the row itself could, so it
  overflowed its panel. Switched to a 2-column CSS grid (Port/Starboard
  paired on top, since they're the natural mirrored pair; Bow — a different
  firing arc — gets its own full-width row below), which also reads better
  on desktop than the old cramped 3-up strip. Confirmed fixed with a real
  Playwright `tap()` on the previously-unreachable Starboard button plus
  bounding-rect checks showing zero off-screen buttons at 320/375/390/1280px.
  (2) `.slot-btn` (40→44px), `.buy-btn` (~32px tall→44px min-height), and
  `.ammo-btn` (42→44px) were all under the 44×44 touch-target minimum;
  bumped all three, verified via `tap()` (ammo-selector fire-shot swap) and
  bounding-rect measurement. Verified via before/after screenshots at
  375×667 plus a 1280×800 desktop screenshot to confirm the grid layout
  doesn't regress the non-mobile view. Not addressed this pass: the
  mute/chat/help icon-button cluster measured a ~22×18 hit area, well under
  44×44 — flagged as a handoff below rather than shipped, since fixing it
  safely needs a real layout treatment (naively growing all three risks
  colliding with the health-bar/gold-counter cluster at 375px width) that
  wasn't feasible to verify cleanly in the same pass.
- [x] **Shipyard soft-lock regression fix (S):** a `qa-verify` pass over the
  combined output of three specialists (including the mobile touch-target
  pass above) caught a real bug the `.buy-btn` 44px bump introduced: on
  short phone viewports the 6 upgrade rows + cannon builder now needed
  ~764px, taller than `#shipyard-panel` (uncapped, no scroll) could show —
  confirmed reproducing the exact regression via Playwright at
  `devices['iPhone 8']` (375×667): panel `y=-64.19, h=795.4`,
  `elementFromPoint` at the "Set Sail" button's center returned `null`.
  Movement/fire are suppressed the whole time `hud.isShipyardOpen()` is
  true, so this was a genuine soft-lock with no way out on phone. Fixed
  with two changes: (1) restructured `#shipyard-panel` into a flex column
  — `<h2>` and the `#shipyard-close` "Set Sail" button now live outside a
  new `#shipyard-scroll` wrapper around the upgrade rows and cannon
  builder, so the close button is always visible and tappable without
  hunting for it mid-scroll, rather than sitting at the bottom of scrollable
  content or relying on `position: sticky` quirks. `#shipyard-panel` caps
  at `max-height: calc(100vh - 32px - safe-area insets)` with
  `#shipyard-scroll { overflow-y: auto }`; a flat `90vh`-style cap was
  tried first and rejected — it forced an unwanted scrollbar even on the
  1280×800 desktop viewport, where the panel already fit at 764px inside
  an 800px screen, because 90% of 800 is only 720. The fixed-gutter
  approach only engages scrolling where the viewport is actually too
  short. (2) Added an Escape-key handler to `HUD` (`onShipyardClose` fires,
  mirroring how `Chat` already closes on Escape) as a keyboard-independent
  safety net regardless of the scroll fix — costs nothing on desktop,
  guarantees a way out on any device with a keyboard even if a future
  layout change reintroduces overflow. Verified: `devices['iPhone 13']`
  (390×664, panel h=632, fits) and `devices['iPhone 8']` (375×667, panel
  h=635, fits, the stricter case) both show the panel now within viewport
  bounds with a real Playwright `tap()` on "Set Sail" closing the shipyard;
  Escape also closes it on iPhone 8. Desktop (1280×800) re-confirmed
  unchanged at its natural 764px height — no scrollbar, no layout shift.
  The Starboard cannon-slot grid fix from the prior pass was re-verified
  intact (bounding-rect + `elementFromPoint` on the Starboard `+` button)
  at all three viewports.
- [x] **Minimap/compass (S/M):** a circular radar in the top-right corner
  (`src/ui/Minimap.ts`) shows nearby islands (home port marked gold),
  other ships as color-coded blips (blue players, red bots, brighter
  orange/red for rivals and bosses), and your own heading as a center
  triangle that doubles as a compass. When home port is out of the shown
  ~240-unit range, an edge arrow points toward it.
- [x] **Better art pass (M/L):** the geometry itself was the problem, not the
  shading — hulls were a `BoxGeometry` with a few vertices nudged sideways
  and beaches were 20-segment cylinders with countable facets. Ships are now
  lofted from cross-section stations (rounded bilge, real sheer curve, fine
  bow entry, transom stern) with a cambered deck, rails swept along the
  sheer, yards, shrouds and bellied sails; classes above sloop carry a
  second mast so they read structurally and not just as "bigger". Islands
  got 64-segment shelves with a wobbled, irregular coastline, radial
  ridge/gully relief on the hill (two extra fine octaves for rockiness, each
  faded out right at the summit — the longitude lines converging at a
  sphere's pole make any angle-dependent term alias into a jagged starburst
  there otherwise), an irregular bare-rock summit cap, and boulder clusters
  scattered at varying elevations instead of only near the shore. Hull
  *shapes* now differ per class too, not just scale: `beamProfile`/
  `sheerProfile` take a `HullClass` and brigantine/galleon get a fuller
  beam and a stepped, raised sterncastle (one tier / two tiers) — each tier
  is built deliberately deeper than its nominal footing and embedded into
  the one below, since the hull's raked, curved stern can't be matched
  exactly by a flat-bottomed box and the mismatch showed as a visible gap.
  Day-night cycle explicitly out of scope per the user.
  **Follow-up:** a user pass flagged ships still looking "partially
  submerged" even after the above — root cause was `WATERLINE_OFFSET`, a
  flat world-space constant applied to every hull regardless of its own
  scale, so it cut away a much bigger fraction of a small hull's designed
  freeboard than a big one's (bots at scale 0.9 rode almost gunwale-deep;
  the player's own scale-1 sloop showed barely a sliver of hull above water
  — confirmed via close broadside screenshots, not just eyeballing the
  normal chase-cam view). Fixed by scaling the offset with the hull's own
  `scale` in `syncVisual` and retuning the constant so exposed freeboard is
  roughly half the hull's total vertical extent across all classes, not
  just the one scale it happened to be tuned against originally.
- [x] **Island self-shadow smear (S):** a follow-up "still seems pretty bad"
  complaint about overall graphics quality was never root-caused with a
  specific fix, so this pass was a genuinely fresh critical audit —
  screenshots first (broadside, wide sky/water/lighting, island close-up,
  gameplay chase-cam, at both a 1280×800 desktop and a 390×844 phone
  viewport), reviewed like real dailies before touching anything, rather
  than assuming prior work was already good enough. The clearest, most
  consistent problem across those screenshots: every island showed a large,
  soft-edged dark blob smeared diagonally across its slope (and spilling
  onto the sand shelf below it) from many camera/sun angles — pixel-cropped
  the screenshots to confirm it wasn't texture noise. Root cause: hills in
  `World.ts`'s `buildHillMesh` have real geometric relief (the
  `relief` calc's low-frequency ridge/gully octaves, amplitude up to ~15%
  of `hillRadius` — several world units on a home-port-sized island), large
  and smooth enough to cast a genuine self-shadow via the directional
  light's shadow map, but the shadow map (2048px, `PCFSoftShadowMap`)
  renders that low-frequency bump as one big soft binary-occlusion blob
  rather than believable small-scale terrain shading — it reads as a dirt
  stain, not form. Fixed by setting `castShadow = false` on the hill mesh
  (kept `receiveShadow = true`, so ships/masts sailing past still shadow the
  island correctly); the vertex-color height gradient plus normal-based
  Lambertian shading from `computeVertexNormals()` already sells the hill's
  roundness without the self-shadow pass. Verified by re-shooting the exact
  camera angle that showed the worst smear before/after — confirmed gone,
  replaced by a smooth, natural-reading light-to-dark gradient — plus a
  final unrelated-angle sanity screenshot to confirm no regression. Side
  benefit: one fewer mesh in the shadow depth pass per island, a small
  perf win, not just a wash. Other candidates checked and ruled out this
  pass: cannon/splash/hit particle effects in `Effects.ts` (simple but not
  glaringly cheap — small additive-blended spheres read fine at gameplay
  scale), cloud quality in `Sky.ts` (held up under close inspection, no
  fix needed), hull/island material response under lighting (roughness/
  color read as intended, not the standout issue).
- [x] **Water shading (S):** the ocean was fully unlit — one flat color band
  regardless of light or camera angle, the single biggest "cheap" surface
  in the scene since it's visible almost 100% of the time. Now computes an
  analytic per-vertex normal from the wave slope and adds a fresnel blend
  toward a sky-reflection tint at grazing angles plus a tight specular sun
  glint, synced to the scene's actual `DirectionalLight` position (passed
  into `Ocean`'s constructor, not hardcoded). Foam at wave crests is
  unchanged. Still open: foam trails behind moving ships, real reflections.
- [x] **Shoreline foam + wet/dry island gradient (S):** islands looked like
  they were floating in uniform-depth water with no transition. `Ocean.ts`
  now takes a `setIslands()` call (islands arrive from the server after
  Ocean is constructed) and blends toward the existing foam color in a
  soft, animated band around each island's actual shore edge (`radius *
  1.15`, matching the beach shelf's real bottom radius) — reuses the
  wave-crest foam system rather than a new one. `World.ts`'s beach shelf
  also gained a vertical wet→dry vertex-color gradient (darker/cooler near
  the waterline), matching the technique `buildHillMesh` already used;
  previously the shelf was one flat material color. Verified with no
  shader compile errors at both a desktop and iPhone-emulated viewport.
- [x] **Ocean LOD for low-end mobile (S):** profiled with Playwright at an
  iPhone-13 viewport (`renderer.info` + rAF frame-delta timing over 180
  frames). The ocean mesh was the dominant cost in the scene by a wide
  margin — 131,072 of the scene's 171,239 triangles (79%) — because
  `PlaneGeometry(2200, 256, 256)` tessellates uniformly all the way to its
  edges, but the mesh follows the player and only needs to reach the fog
  cutoff (`scene.fog` ends at 950); the outer band past that is fully
  fog-occluded yet cost exactly as many vertices/triangles as the water
  right under the ship. Fixed in `Ocean.ts` by re-mapping each vertex's
  offset from the mesh centre through a power curve
  (`sign(u)*|u|^1.8`) after building the same `PlaneGeometry` — same
  topology and triangle/vertex count, no seams to stitch, just packed
  toward the centre where detail is actually visible and coarser toward
  the edges where it never was. Paired with dropping segments 256 → 128 in
  `main.ts`, which nets out finer resolution under the ship than the old
  uniform grid (~0.6 vs 8.6 world units at dead centre) while roughly
  halving the vertex count. `followTarget`'s position-snap grid size now
  tracks the new finest cell (~0.6 units) instead of the old uniform one,
  so the snap-to-grid that stops waves "swimming" as the mesh re-centres
  is unaffected. Result: scene triangles 171,239 → 65,237 (-62%), draw
  calls 141 → 91, avg frame time (unthrottled, iPhone-13 viewport, this
  sandbox's software-rendered GPU) 372ms → 314ms (-16%). Verified no
  visible change via before/after screenshots at both the default
  near-ship camera and after sailing out to open water for a clear
  horizon view — the difference is only in the numbers. Bundle size
  unaffected (596.52kB → 596.74kB, noise from a few extra lines).
  Still open: island LOD and shadow-map cost untouched by this pass.
- [x] **Save to an account instead of localStorage (M):** superseded by the
  multiplayer server below — progress now lives in
  `server/data/players.json`, keyed by captain name, instead of the
  browser's localStorage.

## Tier 5 — Stretch / long-term

- **Async multiplayer leaderboards (M):** global "richest pirate" / "most
  ships sunk" boards — cheap social hook without needing live multiplayer.
- [x] **Live co-op multiplayer (L):** done for a LAN-hosted friend group — see
  "Multiplayer follow-ups" below for what's still missing before this is a
  polished multiplayer game rather than a working first cut.
- **Native app packaging (M):** wrap as an installable PWA (manifest +
  service worker) for add-to-homescreen, or Capacitor-wrap for app stores.

## Multiplayer follow-ups (from the LAN co-op build)

The server is authoritative (`server/`) and clients are thin renderers of
its state (see `README.md` for how to run it). What's deliberately not in
this first cut:

- **PvP (M):** currently player cannonballs only damage bots, never other
  players. Would need a toggle/flag (or a designated duel area) to opt in,
  since griefing would otherwise ruin the co-op loop.
- **Internet hosting (S/M):** works today over a LAN only (client derives the
  WebSocket URL from `window.location.hostname`). Hosting on a public VM
  needs a real domain/TLS (`wss://`) and probably a reverse proxy in front of
  the raw `ws` server.
- **Rooms/matchmaking (M):** one fixed world today — fine for a few friends,
  but there's no way to run multiple simultaneous games from one server
  process.
- [x] **Reconnect handling (S):** a dropped socket now freezes the ship in
  place (frozen "ghost ship," still visible to others) for 60s instead of
  deleting it; rejoining with the same captain name within that window
  reclaims the exact ship — position, health, and all — instead of
  respawning fresh at port.
- [x] **Chat (S):** simple text chat — press Enter anywhere to open a chat
  box, Enter again to send, Escape to cancel. Broadcast to everyone in the
  world, rendered with HTML-escaped text since it comes from other players.
  Still open: map pings specifically (a non-text "look here" marker).

---

**Suggested next session's focus:** a user pass flagged gameplay quality
directly — combat impact/weight, repetitiveness, cheap visuals, and now
onboarding are all addressed (hit feedback pass + ramming + lit water/sky +
real hull/island geometry + first-run tutorial). Day-night cycle explicitly
deferred per the user. Next, roughly in order: (1) PvP with an opt-in
toggle once ready to defend the co-op loop from griefing, (2) mobile
hosting/testing pass (tunnel for quick testing, or real `wss://` hosting
for anything durable) — the touch controls exist but the newer UI has never
been checked on a real mobile viewport.
