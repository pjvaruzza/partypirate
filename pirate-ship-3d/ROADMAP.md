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

- **Ship classes (M):** unlockable hulls (sloop → brigantine → galleon) with
  different base stats and max cannon slots, instead of just leveling one
  hull — gives a clearer sense of "growing" your ship.
- **Quests/treasure maps (M/L):** islands hide buried treasure found via a
  map fragment dropped by enemies or bought at port; a simple quest chain
  building toward a legendary boss ship.
- **Reputation/heat (M):** sinking ships raises a "wanted level" that spawns
  tougher hunter fleets the longer you stay out — a natural risk/reward timer
  that pushes you back toward port (classic push-your-luck loop).
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

**Suggested next session's focus:** the multiplayer basics (reconnect + chat)
are done. PvP (with an opt-in toggle so it doesn't wreck the co-op default)
is the next highest-leverage piece — everything else in this list (rooms,
internet hosting) matters more once there's an actual reason to run more
than one instance.
