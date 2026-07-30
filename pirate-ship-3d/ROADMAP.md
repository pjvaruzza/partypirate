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

- **More powerup/ammo types (M):** chain shot (disables sails temporarily),
  grapeshot (extra damage vs. crew/hull at close range), fire shot (ignites
  sails, damage over time) — gives loadout choices beyond just "how many
  cannons per side."
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
- **Performance pass for low-end mobile (S/M):** LOD for distant islands/
  ocean segments, cheaper shadows, frame budget testing on a throttled device.
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
