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

## Tier 2 — Combat depth & variety

- **More powerup/ammo types (M):** chain shot (disables sails temporarily),
  grapeshot (extra damage vs. crew/hull at close range), fire shot (ignites
  sails, damage over time) — gives loadout choices beyond just "how many
  cannons per side."
- **Ramming (S):** colliding into an enemy at speed damages both ships,
  rewards aggressive close-range play as an alternative to broadsides.
- **Named rival captains (M):** occasional unique mini-boss enemy ships with
  a name, distinct color/flag, and a special behavior (faster, tankier, or a
  signature attack) — memorable encounters instead of anonymous reskins.
- **Boarding (L):** at low enemy health, option to board instead of sink —
  higher risk/reward loot, maybe a quick-time or mini-minigame.

## Tier 3 — Progression & content

- [x] **Ship classes (M):** three tiers — sloop (2 base cannon slots) →
  brigantine (4 slots, 900g) → galleon (6 slots, 3000g) — each a real,
  visible hull-size jump (1x/1.3x/1.6x scale) plus a stat bonus folded into
  the existing sail/hull upgrade formulas as "free levels." One-time
  purchases in the shipyard, server-authoritative. Still open: a genuinely
  different hull shape per class (currently same model, scaled) and a second
  mast for the bigger classes.
- [x] **Quests/treasure maps (M/L):** sinking a bot has a 25% chance to drop
  a torn map (if you don't already have one active), revealing a glowing
  marker at a random island; sailing into range digs up 200–600 gold
  (scaling with hunts completed). Every 5th completed hunt now spawns a
  legendary boss ship near you instead — a much tougher bot (612 HP vs. a
  normal Tier-4's 180, 4 broadside cannons) with an escalating name/reward
  (1000, 1500, 2000g...) each time, rendered with a distinct black-hull/
  blood-red-sail look and 1.5x scale. Closes the original "quest chain
  building toward a legendary boss ship" idea. Still open: bosses currently
  only ever spawn from this trigger and are otherwise identical bot AI —
  a unique boss-only attack pattern would make them feel less like a reskin.
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

- **Onboarding (S):** a short first-run tutorial overlay explaining controls
  and the cannon builder instead of dropping the player in cold.
- **Minimap/compass (S/M):** show nearby islands, the home port direction,
  and threat blips — helps orientation once the world feels bigger.
- **Better art pass (M/L):** replace procedural low-poly meshes with real
  (or nicer procedural) ship/island models, a day-night cycle, better water
  shading (foam trails behind the ship, reflections).
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

**Suggested next session's focus:** the world-builder loop is now quite full
(upgrades → ship class → treasure hunts → escalating boss fights →
risk/reward heat). Good next steps, roughly in order: (1) a unique boss
attack pattern so legendary ships feel less like a reskin, (2) named rival
captains (Tier 2) — the hunter-ship infrastructure from heat is most of
what that needs already, (3) PvP with an opt-in toggle once the co-op
progression loop feels rich enough to be worth defending from griefing.
