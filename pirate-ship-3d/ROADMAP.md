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
  "sink" sting, a distinct heavier ram-impact crunch, and a looping
  wind/wave ambient bed — all synthesized live via Web Audio (filtered
  noise + oscillators), no audio assets needed. See `src/game/Audio.ts`.
  Still open: wood-creaking detail layer, real music.
- [x] **Burning-ship audio cue (S):** audited which of this session's new
  mechanics (ammo types, ramming, status effects) were silent — `ram`
  already had its own `ramImpact()` (confirmed distinct from the generic
  `hitImpact()`), but fire-shot's burning status had *no* audio at all
  beyond the identical-to-any-other-hit initial impact: the `hit` event
  doesn't carry `ammoType`, so there wasn't even a distinct "catches fire"
  sting, and the several-seconds-long ticking burn (`ShipSnapshot.burning`)
  went completely silent after that. Added `SoundManager.setBurning()`: a
  breathing bandpass-noise roar bed (LFO-modulated cutoff so it "breathes"
  like flame) plus randomly-timed high-passed crackle pops scheduled via a
  self-re-arming timer that checks `this.burning` before each re-arm (so
  stopping drains to zero extra nodes/timers, no leaked chain). Wired in
  `main.ts` only for the local player's own ship (`isYou`), not every
  burning ship in a fight — this game's audio is non-spatial (no panning),
  so mirroring every burning ship's status would mean one extra looping
  voice per burning ship in a chaotic multi-ship fight, exactly the "dozens
  of simultaneous oscillator graphs" mobile-audio failure mode to avoid;
  the local-ship-only cue is also the highest-value case since it's the
  player's own persistent-damage warning. Also force-stops the loop on the
  local player's own `sunk` event as a defensive backstop against depending
  on state-sync timing. Verified via Playwright: `AudioContext.currentTime`
  progresses normally through a 300-call burst of fire/hit/splash/ram with
  no console/`AudioContext` errors; `setBurning(true)` creates exactly one
  bed+timer pair and repeated idempotent calls don't duplicate nodes;
  rapid on/off cycling tears the bed and timer down cleanly every time
  (`burnBed`/`burnCrackleHandle` both null afterward); `setMuted(true)`
  zeroes `masterGain` immediately while burning is in flight (silent, but
  the logical burning state is preserved so it resumes seamlessly on
  unmute — matches how mute already behaves for everything else in this
  file). `npx tsc --noEmit` and `npm run build` both clean.
  **Flag for gameplay-designer:** `fire`/`hit` events carry no `ammoType`,
  so chain/grape/fire cannon fire and the initial fire-shot hit all still
  sound identical to round shot — a genuinely distinct ignition sting and
  a chain-shot "fouling" whirr/snap are the next-best silent-mechanic gaps,
  but both need `ammoType` added to those `GameEvent`s first.
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
  complexity added for ammo selection. **CORRECTION (open-PvP pass):** the
  "player-vs-bot only" caveat here is obsolete — every ammo type now works
  identically against other players. Chain shot in particular is much more
  interesting in PvP than it ever was against bots: crippling a loaded
  captain's sails so they can't reach port is now a real play.
- [x] **Ramming (S):** driving your hull into a bot at speed (≥3.5 units/s
  relative closing speed) damages both sides, scaled by that closing speed
  (capped at 45) — reuses the same damage-number/hit-stop/shake feedback as
  cannon hits, plus a distinct, heavier wood-crunch effect and sound. Pushes
  both ships apart and bleeds their speed on contact so they don't stay
  glued together, with a 1.2s per-ship cooldown so one collision doesn't
  melt a target across several ticks. Ram kills pay out the same gold/heat/
  treasure-map rewards as a cannon kill (`killShip()` in `GameRoom.ts`,
  factored out of `resolveCombat` so both paths share it). **CORRECTION
  (open-PvP pass):** no longer player-vs-bot only — `resolveRamming` now
  runs over every ordered ship pair with at least one player, so PvP ramming
  works identically. It stays a trade-off rather than a dominant move for
  exactly the reason it always did: it costs you the same damage you deal.
  Worth knowing: a bot that's already
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
  **CORRECTION (open-PvP pass):** this entry audited *which* tier spawns
  *where* but accepted the world's scale and enemy count as given, and then
  claimed the session pacing was fixed. It wasn't — the owner's playtest
  called out both traversal time and emptiness. The 25% tier-0 intent is
  preserved (and now derived from `worldRadius` rather than a magic `190`,
  so it can't silently desync again), but `worldRadius`, `topSpeed` and the
  enemy cap have all been rescaled. Treat the absolute numbers in this
  entry (900-radius world, `BOT_TIER_STEP = 190`, dist ∈ [120, 870)) as
  historical.
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
  **Follow-up (`#port-btn` focus leak, S):** a later `qa-verify` pass found
  that clicking `#port-btn` left it holding keyboard focus indefinitely —
  neither `showShipyard()`/`hideShipyard()` nor the Escape handler above
  ever called `.blur()`. Since Space is the fire key, a focused `<button>`
  treats Space as native "activate," so pressing Space after closing the
  shipyard (via Escape or the tap-close button) silently reopened it
  mid-combat and hijacked the fire key — desktop-keyboard-only, since
  mobile's touch fire button is a separate element. Fixed with defense in
  depth: `portBtn.blur()` immediately after the click handler in
  `main.ts` opens the shipyard, plus `hideShipyard()` in `HUD.ts` also
  blurs `#port-btn` and any focused element still inside `#shipyard` (so
  tap-close, which focuses `#shipyard-close` itself, is covered too).
  Verified with Playwright at desktop (1280×800) and `devices['iPhone 13']`:
  after opening via a fresh click, closing via Escape and separately via
  the tap-close button, `document.activeElement` was neither `#port-btn`
  nor any shipyard-internal element in either case, a subsequent `Space`
  keypress left `#shipyard` hidden (previously reopened it), and a fresh
  click on `#port-btn` afterward still opened the shipyard normally — the
  side effect was removed without touching the button's actual job.
  Reproduced the pre-fix bug first (Space did reopen the shipyard,
  confirming the harness was valid) before applying and re-verifying the
  fix.
- [x] **"Looks like AI built it" — 2D UI chrome redesign (M):** direct user
  feedback on the shipyard/HUD/controls specifically (not the 3D world).
  Root causes, confirmed against the actual rendered `index.html`/
  `style.css` rather than assumed: (1) the entire UI ran on the
  `system-ui`/`'Segoe UI'` sans-serif stack — nothing distinguished it from
  a generic SaaS dashboard; (2) every panel/button was a flat solid color
  (`#16283b` panels, `#3ea36b`/`#ffb14d` buttons) with uniform 8-14px
  `border-radius` and a single drop-shadow — no texture, no hierarchy
  beyond color; (3) raw emoji (🪙💬❓🔊⚓⚫⛓️🍇🔥) as functional icons, which
  also render inconsistently across OS emoji fonts — confirmed via
  screenshot that ⛓️/🍇 render as near-blank glyphs in this sandbox's
  headless Chromium, i.e. it wasn't just a style complaint but a real
  cross-platform legibility gap; (4) perfectly symmetric, uniformly padded
  modals with no hand-crafted or period detail.
  Fixed entirely with CSS-native techniques — **zero new network requests,
  zero image/font assets**, matching this project's existing
  no-external-assets rule: a serif display stack
  (`Georgia, 'Iowan Old Style', 'Palatino Linotype', ... serif`) with
  `font-variant: small-caps`, letter-spacing and an engraved text-shadow on
  every heading; a shared `.panel-wood` class (join/shipyard/tutorial
  panels) with a twisted-rope-look border built from
  `border-image: repeating-linear-gradient(135deg, #8a6633 0 4px, #4a3216
  4px 8px)`, a parchment-toned `linear-gradient` face
  (`#ead9ad`→`#cdb27c`), and layered inset `box-shadow`s for a carved
  bevel instead of a flat 2px border; a brass-gradient `.btn-primary`
  (`linear-gradient(180deg, #f0cf6a, #c9a227 55%, #7a5a12)`) reserved for
  the one primary action per screen, with a darker-wood `.buy-btn` variant
  for the shipyard's repeated secondary actions; brass-rimmed circular
  `.icon-btn`s (chat/help/mute) replacing bare emoji glyphs; hand-authored
  inline `<svg>` icons for chat, mute/unmute (two-state, toggled via a
  `.muted` class the same way `.desktop-hint`/`.touch-hint` already toggle,
  rather than a new mechanism), anchor (`#port-btn`), and all four ammo
  types (round shot is a plain CSS radial-gradient sphere, chain shot two
  linked rings, grapeshot a 4-dot cluster, fire shot a flame path tinted
  with a distinct ember color so it doesn't read as "generic brass" like
  the metal ammo types); health/heat bars restyled as dark gunmetal-gauge
  troughs with a blood-red→ember fill instead of the previous flat pill
  gradient. The shared gold-coin SVG is defined once in `HUD.ts`
  (`COIN_ICON`) and interpolated into the buy-button `innerHTML` so the
  dynamic shipyard buttons and the static `#gold-counter` render an
  identical icon rather than drifting.
  **Regression risk this pass specifically re-verified, not just
  assumed fine:** the `.icon-btn` restyle for chat/help/mute grew them
  from a previously-unaddressed ~22×18px hit area (flagged but not fixed
  in the touch-target pass above) to a real 44×44px target, which required
  restructuring `#hud-top-right` from a single row into a
  ship-name-over-icon-row column — re-checked the minimap doesn't overlap
  (`#minimap`'s `top` offset moved 62px→108px to clear the taller
  cluster). The bigger border/padding/heading-divider on `.panel-wood`
  initially pushed the shipyard panel's natural height from ~764px to
  ~792px, which would have reintroduced an unwanted scrollbar on the
  1280×800 desktop viewport the prior soft-lock fix explicitly tuned
  against (a flat `90vh` cap was rejected there for the same reason) —
  caught by directly measuring `#shipyard-scroll`'s `scrollHeight` vs.
  `clientHeight` before/after, not by eyeballing a screenshot, then trimmed
  border width, heading margins, and per-row padding until natural height
  (751px) cleared the `calc(100vh - 32px)` cap again with margin.
  Re-verified with Playwright at desktop (1280×800) and `devices['iPhone
  8']` (375×667, the stricter viewport used throughout this session): the
  shipyard's `#shipyard-close` is reachable via `elementFromPoint` and a
  real `tap()`/`click()` at both sizes, Escape still closes it, the
  Starboard cannon-slot `+` button bounding box is fully on-screen at both
  sizes, the ammo selector's fire-shot button both measures 44×44px and
  actually toggles `.active` on click, `#chat-toggle-btn` measures
  44×44px, and the `#port-btn` focus/Space-reopens-shipyard regression
  from the prior fix stays fixed (`Space` after a tap-close leaves
  `#shipyard` hidden). `npx tsc --noEmit` and `npm run build` both clean;
  `grep -c "__pg\|__probe\|__debug" src/main.ts src/ui/*.ts` returned 0
  everywhere (no debug hooks were needed for this pass — every check used
  real DOM/bounding-box queries against the live page).
  **Follow-up correction:** despite the re-verification above, two real
  regressions from this same redesign slipped through — the prior pass's
  own checks confirmed the Starboard slot's bounding box and
  `#shipyard-close` reachability but never actually measured the Bow row
  (grid-row 2, the one most likely to sit at the clipped boundary) or the
  ship-class button's text width. Found independently via direct
  `getBoundingClientRect`/`elementFromPoint` checks, not screenshots: (1)
  the added heading/border/row weight had pushed `#shipyard-scroll`'s
  content to 580px against 464px of visible area at 375×667 (116px over),
  and `elementFromPoint()` at the Bow minus-button's own computed center
  returned `#shipyard-close` instead of the button itself — a tap there
  hit "Set Sail," not the cannon control; (2) `#class-buy-btn` measured
  `scrollWidth: 124` vs `clientWidth: 112` (12px of "Buy Brigantine 900"
  running past the button's right edge) — the longest labels in the panel,
  which the shared `.buy-btn` 88px min-width was never sized for. Fixed by
  choosing "make everything fit" over "make scrolling discoverable" for
  bug 1, since the overflow was recoverable without touching any 44px
  touch target: added a touch-only (`(hover: none), (pointer: coarse)`,
  the same query the desktop-hint/touch-hint swap already uses) compaction
  pass — tighter panel padding (24px→12px), thinner rope border
  (6px→4px), smaller/tighter heading (26px/12px margin→21px/6px), tighter
  row padding (8px→4px), a widened `.upgrade-desc` max-width (220px→260px,
  which puts the two longest upgrade descriptions at one line instead of
  two — free height, since the buy button's 44px min-height was already
  the taller floor either way), and trimmed cannon-builder/hint/close-
  button spacing — leaving desktop's default rule (and its rope
  border/heading size, the redesign's actual visual identity) completely
  untouched. Content height dropped from 580px to 506px against a
  506px-tall `#shipyard-scroll` at 375×667 (0px overflow, confirmed at
  both iPhone 8's 667px and iPhone 13's slightly-shorter 664px viewport
  height) — `elementFromPoint` at the Bow minus/plus buttons' centers now
  returns the buttons themselves, and real Playwright `tap()`s (not
  trials) on Bow and Starboard's plus/minus actually incremented/
  decremented `.slot-count` end-to-end through a live server connection.
  Bug 2 fixed with a dedicated `#class-buy-btn` rule (`min-width: 140px`,
  tighter `10px` horizontal padding) rather than widening every `.buy-btn`
  in the panel — `scrollWidth`/`clientWidth` now match exactly (138px/
  138px) for both "Buy Brigantine 900" and the even-longer "Buy Galleon
  3000". Re-verified everything the prior pass claimed still holds at
  375×667: Starboard slot on-screen and tappable (real tap, not just
  bounding-box math), ammo selector functional (`.active` toggles on
  tap), `#shipyard-close` reachable via tap and `Escape`, `#port-btn`
  Space-reopen regression still fixed. Desktop (1280×800) unchanged and
  unaffected by the touch-only media query — `#shipyard-scroll` still
  measures 580px/580px (0 overflow), identical to the prior pass's
  numbers. `npx tsc --noEmit` and `npm run build` both clean;
  `grep -c "__pg\|__probe\|__debug"` returned 0 across all changed files
  (only `src/style.css` changed this pass — no HTML/TS touched).
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
  **Correction (see "Ocean and islands rebuilt" at the end of this file):**
  the `[x]` above is accurate about the *ships*, but its claims about the
  *islands* ("64-segment shelves… ridge/gully relief… boulder clusters") are
  now obsolete. That work was a better version of one silhouette — a
  hemisphere on a sand cylinder — which the owner subsequently described as
  "nubs popping out of the ocean." The islands described there no longer
  exist; see the rebuild entry for what replaced them.
- [x] **"Ships look partially submerged", third pass — actually fixed (M):**
  the complaint survived two `WATERLINE_OFFSET` retunes, so this pass
  deliberately refused to touch that constant again and instead instrumented
  the renderer. **Method that finally settled it:** joined a real game, froze
  `elapsed` and pinned the ship via temporary probe hooks, then (a) planted
  marker spheres at known world Y either side of the surface, (b) diffed a
  render against one with `ocean.mesh.visible = false`, (c) repainted the
  ocean's fragment shader flat magenta, and (d) raycast down a screen column
  to map pixel rows to world Y. Result: **the ocean was already clipping the
  hull at the correct height** (rendered cut at local y +0.014 against a wave
  surface at −0.091) — the Y offset was never the real problem, which is why
  retuning it twice didn't help. Five separate causes were found instead:
  1. **A hole in the transom.** `buildLoftedHullGeometry` fanned the stern
     closed from a centroid over the U-shaped station ring only, leaving a
     wedge above the two spokes uncovered. Dead astern — precisely the chase
     camera's angle — you could see open sea *through* the back of the ship.
     Fixed by also fanning the rail-to-rail closing edge (and adding the same
     closure at the stem).
  2. **No bulwark.** The deck *was* the sheer line, so at the chase camera's
     ~23° pitch a hull 4 long and 0.92 deep projected its whole deck plan and
     only a ~0.3 sliver of hull side: you looked into an open dish. Deck is
     now recessed `BULWARK_HEIGHT = 0.34` below the rail, and the hull
     material went `DoubleSide` so the inner topsides aren't culled away.
  3. **Wineglass sections.** The loft used `x = beam * v^0.5`, which pinched
     to almost nothing by the waterline, so every hull met the sea in a thin
     V. Now `v^0.35` (new `sectionFullness`): waterline half-beam at the
     transom goes ~40% → ~65% of the rail's, amidships 67% → 79%. Keel rocker
     softened 0.55 → 0.42 so the transom stays immersed.
  4. **No water-contact cue at all.** Added `buildFoamCollar` — a closed,
     offset foam ring traced along the hull's actual waterline outline
     (deliberately a *ring*, not two side strips: side-only foam is
     self-occluded by the stern from the chase camera, the one view that has
     to look right), widening into a bow wave and a wake, opacity driven by
     speed. Plus a boot-top: hull vertex colours darken below y = 0.
  5. **The sea was bigger than the ships.** Ocean amplitudes summed to 1.65
     (3.3 peak-to-trough) against a hull 4 long and 0.92 deep, so water 8
     units from a ship could be a whole hull-depth below its waterline —
     measured 1.01. Now 0.46/0.25/0.13 (sum 0.84, delta at 8 units 0.51);
     `smoothstep` thresholds for depth colour (−0.6/1.2 → −0.31/0.61) and
     crest foam (1.05/1.5 → 0.53/0.76) rescaled to match, or crest foam would
     simply have stopped existing.
  Also: `WATERLINE_OFFSET` is **deleted**, not retuned — hull-local y = 0 is
  now the waterline by definition (`HULL_DRAFT` 0.42 → 0.62 below it,
  `HULL_FREEBOARD` 0.50 → 0.74 above, L/D 4.3 → 2.9), so there is no longer a
  fudge factor to mis-tune a fourth time. `Ship.syncVisual` takes an optional
  wave sampler and rides the chord between its own bow and stern (allocation-
  free: one closure created once in `main.ts`), which cuts the worst-case
  water-above-gunwale error across the hull from 0.27 to under 0.05, and
  gives real pitching over swells for free. Chase camera lowered from
  `(0, 7, 13)` to `(0, 5.2, 13)` — 23° → 16° — halving the deck's share of
  the silhouette. Verified with real sailing gameplay (not posed) at 1280×800
  and 390×844 @3x, plus frozen wave-crest and wave-trough shots at an
  identical camera, all three hull classes, and a broadside close-up.
  **mobile-perf follow-up (checked both explicit handoffs from that pass):**
  1. **Foam collar draw calls — real bug found and fixed.** The handoff
     estimated "one transparent draw call per ship"; measured (wrapping
     `renderer.getContext().drawElements`) it was actually **two** draw calls
     submitting the same 148-triangle index buffer, 296 triangles per ship.
     Root cause: three.js's `WebGLRenderer` renders any `transparent: true` +
     `side: DoubleSide` material as two passes (back faces, then front) by
     default, specifically to fix self-overlap alpha-sorting — see
     `Material.forceSinglePass`'s own doc comment, which names flat
     double-sided geometry (its example: grass sprites) as the exact case
     where this buys nothing but doubles draw calls. The foam collar is
     precisely that case: a thin flat ring with `depthWrite: false` already
     set, so there's no self-sorting artifact for the two-pass split to
     prevent in the first place. Fixed by setting `forceSinglePass: true` on
     the foam material in `Ship.ts`. Verified pixel-identical at chase-cam,
     broadside, and dead-astern (the closed-ring view the geometry comment
     says matters most) before/after. At a realistic combat scene (1 player +
     `MAX_ENEMIES`=6 bots, `server/src/GameRoom.ts`, measured via Playwright
     at an iPhone-13 viewport, `renderer.info` on a synthetic 7-ship scene
     matching `shipVisualOptions`' bot branch): **205 → 198 draw calls
     (-3.4%), 77,531 → 76,495 triangles (-1.3%)**. Small in absolute terms at
     7 ships, but it's a real per-ship inefficiency with zero visual cost to
     fix, so it's fixed rather than left as a rounding error that would have
     compounded if ship counts ever grew.
  2. **Hull `DoubleSide` — measured, kept, not a waste.** The handoff wasn't
     sure this had any visual benefit at this screen size. Rendered the same
     hull with `THREE.FrontSide` at the game's actual chase-cam offset
     (`(0, 5.2, 13)`, matching `main.ts`) and screenshotted: **FrontSide
     produces a real, visible hole** — dead astern, directly behind the sail,
     the recessed-bulwark interior face (a back face of the outward-wound
     hull shell) disappears and open sea/sky shows through where `DoubleSide`
     renders solid hull wall. Broadside view was pixel-identical between the
     two (as expected — you only ever see front faces from the side), so the
     cost is genuinely confined to the one view that has to look right.
     Confirmed via `renderer.info` that `DoubleSide` on this **opaque**
     material (unlike the foam's transparent one) causes no extra draw calls
     or triangles — the three.js two-pass split only triggers for
     `transparent: true`, so this is pure backface-culling behavior with a
     real, measured visual payoff and no measured CPU-side cost. Left
     unchanged.
  3. **Hull triangle budget re-audited post-rework — ocean is still the
     dominant cost, hull did not take over.** Measured with the same
     7-ship combat scene: ocean+sky alone is 33,984 triangles (unaffected by
     ship count); the 7-ship geometry itself (excluding the shadow-map pass,
     which re-submits every `castShadow` mesh a second time from the light's
     POV and is a property of `shadowMap.autoUpdate` defaulting to `true`,
     not something this rework changed) adds 24,493 triangles — 3,499/ship
     for a sloop up to 4,291/ship for a fully-loaded 2-mast galleon
     (`hullClass: 2`, 8-gun loadout). Ocean remains the single largest mesh
     by a wide margin (32,768 raw triangles) over any individual ship. Total
     scene at realistic 7-ship combat, shadow pass included: 76,495
     triangles / 198 draw calls — both comfortably inside the budget this
     class of mobile GPU can sustain, and well below the pre-ocean-LOD-fix
     171,239-triangle figure from the entry above. No action needed here.
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

- [x] **PvP (M):** ~~currently player cannonballs only damage bots, never
  other players. Would need a toggle/flag (or a designated duel area) to opt
  in, since griefing would otherwise ruin the co-op loop.~~ **Superseded.**
  The owner made the call: full open PvP, no opt-in. Shipped — see the
  "Open PvP + unbanked gold + world rescale" entry at the bottom of this
  file for the anti-griefing design (which is economic, not a toggle) and
  the exact verification values.
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

## Open PvP + unbanked gold + world rescale (answers PLAYTEST_FEEDBACK #1, #3, #6)

The owner's verdict on the loop was *"overall game play is lame… is it just
that you go around shooting others?"* The honest diagnosis was that the loop
had **nothing at stake** — death cost you literally nothing, so no decision
in the game was a real decision. Two product calls were made by the owner
(full open PvP; unbanked gold dropped on death) and one structural error was
corrected (world scale/density). All three are in.

**The loop as it now stands:** leave port with an empty hold → earn gold at
sea (crates, bots, treasure, other captains' spoils) into an *unbanked* hold
→ every minute out, your hold gets fatter, your heat climbs, hunters start
spawning, and every bot in range begins preferring you as a target → decide
whether to keep hunting or run for port → reach the sanctuary and it all
banks permanently, heat drains, and you spend at the shipyard. Get sunk
first and 70% of the hold spills into the water for anyone to scoop.

### 1. World scale and density (feedback #1, #3)

Both were sized against explicit targets, not vibes.

- **Traversal target: full map crossing in ~90s on a stock ship.**
  `worldRadius` 900 → **400**, and `topSpeed` `6 + sailLevel*2.2` →
  `9 + sailLevel*1.6`. Crossing: `2*400/9 = 88.9s` fresh (was `2*900/6 =
  300s`), `2*400/21 = 38.1s` fully upgraded. A mid-band raid and back to
  port is `2*250/9 = 55.6s`.
  **The trade-off is deliberate and it is not a buff:** the floor moved, the
  ceiling didn't. A fresh sloop is 50% faster; a maxed galleon is 6.7%
  *slower* (22.5 → 21). Sail upgrades now buy a 2.33x speed spread instead
  of 3.75x — still worth buying, no longer the tax a new player must pay
  before the game stops feeling like a commute. Boost (14.4 u/s on a fresh
  sloop) remains the escape valve that outruns even a tier-3 bot at 13.8,
  which matters a great deal more now that fleeing protects real value.
- **Encounter target: something worth reacting to roughly every 20s.** A bot
  detects at 90 units, so a player at 9 u/s sweeps 1620 sq units/sec. Over
  π·400² = 502,655 sq units, N bots give a mean gap of `502655/(1620·N)`:
  N=6 in the old 2.54M world was **392s**; N=14 here is **22.2s**.
  `MAX_ENEMIES = 6` is replaced by `10 + 4 per connected player, capped 22`
  (solo = 14) so a busier server doesn't feel thinner per captain.
  `ENEMY_SPAWN_INTERVAL` 8 → 5.
  The more honest statistic than any mean, because the distribution is
  bimodal: **the share of open water that already has an enemy in detect
  range went from 5.8% to 50.8%** (Poisson, `1 - exp(-nπR²/A)`), measured at
  51.0% over 400 live cold-start simulations. Density was deliberately not
  pushed higher — the gaps between contacts are the windows in which running
  a loaded hold home is possible at all, and closing them would remove the
  decision the whole economy hangs on.
- **Islands:** 12 → 18, and `generateIslands` rewritten. It used to place
  them on evenly-spaced spokes at `150 + rand*(worldRadius-150)`, which is
  uniform in *radius* and so heavily centre-biased in *area*, leaving the
  inner disc bare. Now sqrt-distributed radius (uniform per unit area),
  golden-angle spokes, and a rejection test enforcing 34 units of clear
  water between any two shorelines. Density: 211,000 → **26,455 sq units
  per island**, so land is almost always on the horizon and there is cover
  to break line of sight in a PvP chase.
- **Tier curve intent preserved, and made scale-proof.** `BOT_TIER_STEP`
  was a magic `190` that would silently desync from any `worldRadius`
  change. It's now derived: `(worldRadius - 120 - 30) / 4`, i.e. four equal
  quarter-bands, so tiers 0–3 get **exactly 25% each at any world size**
  (was 25.3/25.3/25.3/24.0). The 120-unit inner keep-out doubles as a
  bot-free approach lane to port, which matters much more now that the last
  leg home is carrying something losable.

### 2. Unbanked gold — the thing that was actually missing (feedback #6)

`PlayerShip.hold` (session-only, never persisted) vs `economy.gold`
(banked, persisted, **the only currency the shipyard accepts** — that's what
makes reaching port matter rather than being a formality). All at-sea income
routes through one `addToHold()`, so nothing can accidentally pay into the
safe pile. Entering the sanctuary banks instantly — no docking timer, since
"sail into the ring" is a gesture a thumb can execute and "hold position for
three seconds" is not.

- **70% drops, 30% is destroyed.** A clean 100% drop is maximally tense but
  merely *conserves* gold, so dying costs the world nothing and two players
  can trade kills forever at no loss. The 30% burn means the ocean's
  unbanked wealth decays on every sinking, which is the pressure that pushes
  people to bank instead of endlessly re-contesting the same pile.
- **The killer gets no automatic cut.** They have to stop, turn, and
  physically scoop it, and the chunks are scattered on a ring wide enough
  that no two can be collected in one pass — so a fat hold is genuinely more
  turns to loot and the looter is parked and exposed for proportionally
  longer. A kill becomes a contested scramble a third party can crash, not
  a payout.
- **Recovered salvage lands unbanked and heats you.** Winning a fight makes
  you the next fat target rather than cashing you out. This is the property
  that keeps it from being power creep: success raises your exposure.
- **Anti-griefing is economic, not a rule.** Sinking a player pays *nothing*
  directly — the reward is strictly their hold. So hunting a loaded captain
  is lucrative and hunting a beginner or someone who just banked pays
  literally zero while still costing 35 heat. Spawn-camping the poor is a
  net loss with no special case needed to make it one.
- Salvage lifetime 45s: long enough to fight over, short enough not to
  litter the sea, and short enough to fit a mobile session's attention.
  Treasure-hunt gold goes to the hold too (the run home from a dug-up chest
  is the tensest moment in the game), but hunt *progress* is persisted
  immediately, so a sinking costs the gold and never the chain.

### 3. Full open PvP (feedback #6)

`resolveCombat` no longer skips `ship.isBot === ball.ownerIsBot`; the filter
is now a `canDamage()` that excludes only bot-on-bot fire and protected
ships. `resolveRamming` runs over every ordered pair with at least one
player. Both ammo effects and ram damage apply identically in PvP.

- **Port sanctuary**, radius `home.radius + 45` = 67 units, in which no
  damage flows **in either direction**. Symmetry is the point: a one-way
  shield is a sniper nest you can camp. Sized against weapon range — a
  cannonball flies ~36 units (26 u/s muzzle, ~1.4s flight), so the ring
  can't be shot into from outside or out of from the island. Protection is
  resolved at *impact*, not at launch, so ducking into port genuinely
  disengages you. This is also now the fast-heat-decay ring (it used to be a
  separate, smaller 37-unit circle) — "safe", "banked" and "cooling off" are
  deliberately one place a player learns once.
- **6s respawn immunity**, forfeited the instant you fire.
- **Disconnected ghost ships are immune** for their 60s reconnect grace —
  otherwise they're trivially farmable, and it would punish exactly the
  mobile players most likely to drop a connection. Rage-quitting still
  doesn't protect a hold: when the grace expires the ship's hold spills as
  salvage anyway.
- **Bots stay relevant and can't be used as cover.** Target selection is now
  `dist / (1 + heat/100)` and skips protected players, so at max heat a bot
  will chase you over a cold player up to 2x closer. Sinking a captain adds
  a flat 35 heat (three kills tops out the meter), so preying on people
  makes the whole world prey on you — the villain feedback loop the heat
  system was built for but never really exercised.

### Verification

Standalone `tsx` script importing `GameRoom` directly, bypassing WebSocket
transport entirely, **100 assertions, all on exact values**. Highlights:

- `topSpeed` = exactly `9` at sailLevel 0 and exactly `21` at 7.5.
- Tier boundaries driven through the real `spawnBotWave` with a scripted
  `Math.random`: dist 120.0→tier 0, 182.4→0, 182.5→1, 245.0→2, 307.5→3,
  369.9→3; 200k-sample shares `0.2509/0.2498/0.2501/0.2491`, tier 4 exactly 0.
- `maxEnemies()` = exactly 10 / 14 / 22 / 22 at 0 / 1 / 3 / 4 players.
- Predicted coverage 50.77% vs **measured 51.0%** over 400 live cold starts
  (mean time-to-contact 15.8s, median 0.1s, p90 42.3s).
- **A player cannonball for 20 damage takes another player from 60 to
  exactly 40** — the assertion that would have read 60 before this pass.
- Sanctuary boundary asserted to the tenth of a unit: protected at 66.9 from
  port, **not** protected at 67.0. Target inside takes exactly 0; shooter
  inside deals exactly 0 outward; spawn-protected takes exactly 0, then
  **exactly 40** after firing clears it; ghost ship takes exactly 0.
- A 250 hold drops `floor(250*0.7) = 175` as chunks `[59, 58, 58]` — summing
  to exactly 175, not 174 (an even split would lose gold to rounding on
  every single death). A 1000 hold caps at 5 chunks of exactly
  `[140,140,140,140,140]`. Banked gold reads exactly 777 after the death
  that spilled the hold.
- Collecting all three chunks puts exactly 175 in the collector's hold and
  exactly 0 in their bank; heat lands at exactly `35 + 175*0.15 = 61.25`.
- 20,000-drop Monte Carlo on chunk scatter: tightest separation **11.281
  units** > the 9-unit pickup diameter. This caught a real bug — the first
  implementation scattered at `9 * [0.35, 1.0]` with 0.7 rad jitter and
  produced chunks **4.24 units** apart, i.e. silently collectable two at a
  time, which would have gutted the "looting is slow and exposed" trade-off.
  My hand-derived bound had used `sin(40°)` where the geometry needed
  `sin(15.95°)`; only the Monte Carlo caught it.
- PvP ram: both ships take exactly 45 (`min(45, 18*2.6)`); exactly 0 inside
  the sanctuary.
- Bot targeting: equal heat → `attack` on the nearer player; hot player at
  75 units beats a cold one at 40 → `chase`; a player in the sanctuary is
  invisible → `patrol`. Bot-on-bot cannonball does exactly 0.
- 300-world island sweep: exactly 19 islands every time (raised placement
  retries 30 → 120 after measuring a ~1-in-300 world coming up short),
  tightest shoreline gap 34.03 ≥ 34.
- `npm run typecheck:server`, `npx tsc --noEmit`, `npm run build` all clean.

### Not done here / handoffs

- **Capturable ports** (feedback #5) explicitly out of scope, queued separately.
- **Ammo legibility** (feedback #2) untouched — still `1,2,3,4` with no
  explanation. Chain shot just became far more interesting in PvP, which
  makes surfacing it more urgent, not less.
- Salvage and the sanctuary ring are rendered with the **simplest possible
  placeholder** geometry in `main.ts` (a coin cluster over an additive
  slick; a flat additive ring). `art-director` owns making these read.
- The hold readout is a bare `#hold-counter` div. `mobile-ux` owns the real
  hierarchy — the "you are carrying 800 unbanked gold and there is a ship on
  your tail" state should be the loudest thing on the screen, and salvage
  should be on the minimap.
- `banked` is a new `GameEvent`. `sound-design` owns the cue — banking is
  the payoff moment of an entire run and currently makes no noise.

---

**Suggested next session's focus:** the loop now has stakes, but three
things are still missing before it's *addictive* rather than merely tense.
(1) **Ammo legibility** (feedback #2) — four tuned trade-offs the player
can't see. (2) **Capturable ports** (feedback #5) — the owner's own idea,
and the one mechanic that would give the 18 islands a purpose, shorten the
bank run, and create territory worth defending. (3) **A reason to return
tomorrow** — there is still no session goal, no leaderboard, no daily
anything; banked gold accumulates but nothing recognises it. Also still
open: mobile hosting/testing on a real device, and graphics, which the owner
has now rejected three times.

---

## Ocean and islands rebuilt (art pass 4 — response to feedback #4)

> "The water just keeps showing wavy blue color gradient. doesnt really add
> much. Islands are just nubs popping out of the ocean"

Three previous art passes each fixed real, verified defects and were each
rejected. This one did not look for a fourth defect. The diagnosis taken from
`PLAYTEST_FEEDBACK.md` was that both systems' **ceilings** were the problem,
and both were rebuilt rather than polished.

### Baseline, confirmed before touching anything

Screenshots at 1280x720 and 390x844@3x of the shipped build:

- Water: one blue-to-lighter-blue ramp driven purely by wave height, with
  broad soft white blobs on the swell tops (the crest-foam `smoothstep`) that
  read as an oil slick. A ship at full speed left **no mark on the water at
  all**.
- Islands: every one of them a green hemisphere on a tan cylinder, differing
  only in scale. The owner's word for it — "nub" — was exact.

### Ocean (`src/game/Ocean.ts`)

Geometry is deliberately **unchanged**: same warped follow-mesh, same three
world-space waves, same `getHeightAt()`. Every floating object in the game
samples that function, and the ship waterline has already been retuned three
times; a displacement-mapped chop would have desynced it and re-opened a
closed bug. All the new work is per-pixel.

- **Depth-based colour.** The island loop now yields a signed distance to the
  nearest coast, which drives an abyss → open-sea → shelf → sand-bottom ramp.
  Water is bright turquoise over a beach and deep blue offshore. It goes
  *negative* inside an atoll, which lights a lagoon up automatically.
- **Ship wakes and bow spray** — the single most damning omission for a
  sailing game. Fully analytic in the fragment shader: a Kelvin V at the
  classic ~19.5° half-angle, a churned centreline wash (three noise octaves,
  so it stays crisp at chase-camera range instead of smearing), and a bow
  collar. No spawned meshes, no particles, no per-frame allocation. `main.ts`
  feeds the six nearest moving ships through an allocation-free
  `beginWakes()/addWake()/endWakes()` API backed by preallocated slots.
- **Fresnel sky reflection** against a `skyAt()` function that mirrors
  `Sky.ts`'s dome gradient, so the water reflects the sky that is actually
  above it and goes mirror-like at grazing angles.
- **Sun glitter.** Two specular lobes; the tight one (`pow(ndh, 620)`) breaks
  into individual sparkles on the new fine chop instead of one wet sheen.
- **Fine chop as a fragment-space normal**, four domain-warped directional
  octaves, faded out between 70 and 260 units. The domain warp is
  load-bearing: four straight sines alone laid down a regular cross-hatch
  that reads as corduroy stripes running to the horizon from a low camera.
- **Whitecaps retuned**: now gated on wave *steepness* as well as height and
  torn up by high-frequency noise. Height alone paints every wide gentle
  swell top solid white, which is exactly the milky-blob look being
  complained about.
- **Surf** widened into breaker lines with a bright waterline lip, following
  the real coastline (below) rather than a circle.
- Diffuse contrast raised 0.3/0.7 → 0.46/0.56: looking almost straight down
  (most of the chase camera's lower screen) fresnel is ~0, so this term is
  the only thing that can show ripple detail there.
- `MAX_ISLANDS` 16 → 24. The world generates 19 islands now; three of them
  had no shore colour or surf at all.

### Islands (`IslandTerrain.ts`, `IslandProps.ts`, `Coastline.ts`, `GeoBuilder.ts`)

`World.ts` is now just the seam between the server's island list and two new
builders. The hemisphere and the sand cylinder are gone.

- **Six archetypes** off one polar heightfield: volcanic cone (with crater
  and ridge spurs), atoll with a real lagoon and passes through the ring,
  cliff mesa (steep on one bearing, beach on the other), multi-peak ridge,
  low sand cay, and a stepped terrace for the home port. Size gates which
  families a given island can be. Elongation on the coastline means plenty of
  them aren't round at all.
- **Slope-aware colouring** with strata banding on exposed rock, and a baked
  concavity term used as cheap AO. That last one matters more than it sounds:
  directional light cannot distinguish a gully from a spur when both face the
  sun, which is why the first cut of this heightfield still looked like a
  smoothly tinted dome despite having real relief in it.
- **Real dressing**: coconut palms with curved tapered trunks and drooping
  folded fronds, scrub, boulders, offshore sea stacks, half-submerged
  shipwrecks, broken stone watchtowers, and a plank jetty with barrels at the
  home port. An island now reads as a place something happened.
- **Determinism fixed.** The old code's comment claimed "every client builds
  identical meshes from the same island list" while seeding its coastline
  wobble from `Math.random()`. In multiplayer the land was a different shape
  on every screen, and the ocean's surf ring never lined up with the beach it
  was breaking on. Everything is now hashed from the island's server-sent
  position, and `Coastline.ts` is the single source of truth that both the
  terrain and the GLSL surf share.

### Bugs found and root-caused during the rebuild

- **Terrain rendered as a black silhouette.** Polar grid winding was
  transposed — `(a,c,b)/(b,c,d)` gives face normals pointing straight *down*,
  so every island was lit entirely from below while its (separately wound)
  beach looked fine. Found by screenshot, not by inspection. Fixed to
  `(a,b,d)/(a,d,c)`.
- **Sea stacks were monoliths.** Height was scaled off the island's *peak*
  (up to 0.65x) with a fixed thin radius, so a 30-unit island got a 2-unit-
  wide, 16-unit-tall slab standing on its beach. Height is now tied to the
  island's radius (0.1–0.28x) with a base radius 35–60% of height.
- **A dead-straight foam edge ahead of the bow.** The Kelvin arms had no
  forward falloff, so they ran at full strength to the `behind > -3` cutoff
  and then simply stopped. Added `smoothstep(-2.4, -0.2, behind)`.
- **Volcanic islands were spikes** at `radius * (0.95..1.3)` tall — taller
  than wide. Now `radius * (0.6..0.92)`, plus ridge spurs so a cone stops
  rendering as a geometrically perfect triangle.
- **Wrecks read as shipping crates**: hull segments were 0.42 beam x 0.34
  depth against 0.5 length, i.e. cubes. Now 0.26 x 0.22 against 0.62, four
  segments, half-submerged at the waterline rather than beached.
- `Ship.ts`'s foam collar opacity backed off `0.42 + 0.5*speed` →
  `0.34 + 0.3*speed`: the ocean now draws its own bow collar, and the two
  summed to a blown-out white ellipse around the hull at speed.

### Cost, measured

Measured directly against the same running server and the same 19-island
layout, by swapping `World.ts` back to `HEAD` and re-running.

| | old | new |
|---|---|---|
| island meshes (all 19) | 257 | **38** |
| island triangles (all 19) | 71,082 | 89,212 |
| shadow casters | 0 | 19 (palms/props) |

Draw calls per island drop from ~13.5 to 2, because every palm, boulder,
frond, stack, wreck and hut is baked into one vertex-coloured geometry by the
new `GeoBuilder`. Against the same posed archipelago cameras: desktop
574 → 390 and 544 → 404 calls; phone 379 → 256 and 248 → 168. Triangles rise
~20–30% in exchange. That is a deliberate trade — this scene is draw-call
bound on mobile long before it is triangle bound.

Ocean geometry and draw calls are **unchanged**; its cost delta is fragment
ALU only. Note that one part of that delta is negative: the island loop now
early-outs on a squared-distance test, where before it ran an `atan` plus
three `sin` per island **per pixel, unconditionally**, for all 19.

### Verification

Playwright, both viewports (1280x720 and 390x844 @3x), real join flow, real
chase camera under sail — the shot the owner actually sees — plus posed
close-ups. Debug hooks stripped and confirmed
(`grep -c "__pg\|__probe\|__debug"` is 0 across `src/main.ts` and
`src/game/*.ts`); `npx tsc --noEmit` and `npm run build` clean.

### Honest assessment / handoffs

This clears a far higher bar than the previous three passes: the chase-cam
frame now has a visible wake, turquoise shallows, glitter, varied
silhouettes and dressing. What is still holding the look back, in order:

1. **Ships are now the weakest thing in frame.** With the sea and the land
   rebuilt, the sloop is a small flat-brown hull with one plain sail. It
   needs the same treatment: hull planking, colour, flags, decoration.
2. **No LOD on islands.** Every island builds at full resolution regardless
   of distance; a posed high camera over the archipelago hit 649 draw calls.
   `mobile-perf` should weigh whether a distance-swapped low-poly terrain (or
   dropping the props mesh past ~250 units) is worth it.
3. **The wake rotates with the ship** rather than staying where it was laid,
   so a hard turn swings the whole trail around. Correct for straight sailing
   (verified), slightly wrong mid-turn. A proper fix needs a scrolling wake
   buffer, which is a bigger change than this pass warranted.
4. Salvage piles and the sanctuary ring are still placeholder additive discs
   from `main.ts` (flagged by the previous session and still true); at close
   range they blow out to white ellipses on the water and now clash with the
   new wake foam.
