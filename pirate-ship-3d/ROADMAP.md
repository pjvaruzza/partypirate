# Roadmap — future enhancements

Ideas to pursue in later sessions, roughly ordered by priority within each
tier. Sizes are rough gut-checks (S = an hour or two, M = a session, L = multi-session).

## Tier 1 — Make combat feel great (do these first)

- **Enemy broadside AI (S/M):** enemies currently just point at the player and
  fire straight ahead. Give them the same loadout system — most enemy ships
  should try to turn broadside-on before firing, so "pull alongside" tactics
  matter for both sides of a fight, not just the player.
- **Juice pass (S):** cannon muzzle flash, splash particles on cannonball
  impact/miss, explosion + debris when a ship sinks, screen shake on taking a
  hit, hit-flash/tint on damaged ships. This is probably the single highest
  fun-per-hour investment — the mechanics already work, they just don't feel
  impactful yet.
- **Sound (S/M):** cannon fire, splashes, wood creaking, ambient wind/waves,
  a sting on sinking a ship, simple looping music. Even placeholder SFX would
  transform the feel.
- **Sinking animation (S):** ships should visibly list and sink over ~2s with
  particles, not just vanish — same for the player on death.

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
- **Save to an account instead of localStorage (M):** needed before this can
  be a "real" cross-device game rather than a single-browser prototype.

## Tier 5 — Stretch / long-term

- **Async multiplayer leaderboards (M):** global "richest pirate" / "most
  ships sunk" boards — cheap social hook without needing live multiplayer.
- **Live co-op or PvP (L):** actual multiplayer is a big lift (netcode,
  server, matchmaking) — worth considering only once the single-player loop
  is proven fun.
- **Native app packaging (M):** wrap as an installable PWA (manifest +
  service worker) for add-to-homescreen, or Capacitor-wrap for app stores.

---

**Suggested next session's focus:** Tier 1 in full (broadside AI + juice +
sound + sinking animation). That's the highest-leverage set — it makes the
existing mechanics feel as good as they already function, before adding more
systems on top.
