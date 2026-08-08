# Mobile Game Ideas

Goal: something **fun** and **hard to put down** — tight core loop, fast time-to-fun,
strong "one more run" pull. Six concepts below, spanning different genres/effort levels.

---

## 1. Splice — one-tap merge roguelike

**Pitch:** Tetris meets a deckbuilder. Creatures/items fall into a small grid; matching
ones fuse into stronger versions. You're not just clearing lines — you're choosing
*which* merges to make, because every merge also triggers an ability (poison the row,
freeze a column, convert enemies) that ripples the whole board.

- **Core loop (15–30 sec/decision):** piece falls → drag to a cell → matches fuse and
  cascade → cascade damages an "enemy board" pushing up from below → survive as long as
  possible.
- **Hard-to-put-down hook:** every run generates a new combo of fusion chains you
  haven't seen (procedurally weighted ability pool), so there's always "what if I merge
  X into Y" curiosity. Runs are 3–6 minutes — perfect commute/bathroom length.
- **Meta-progression:** unlock new creature "lineages" (reskins with different fusion
  abilities) via a slow currency earned per run — classic Balatro/Slay the Spire retention.
- **Monetization:** cosmetic skins for board/pieces, optional "double or nothing" ad-gated
  continue.
- **Build effort:** Medium. Single-player, no server needed for v1.

---

## 2. Overgrown — idle garden you can't stop poking

**Pitch:** An incremental/idle game themed around a garden that grows even while you're
away, but the *fun* part is active tending: pruning, cross-pollinating, and defending
against pests in short bursts.

- **Core loop:** open app → see what grew while away (variable reward, like a slot pull)
  → spend 60–90 sec tapping/dragging to prune, harvest, replant → set new growth timers
  → close app.
- **Hard-to-put-down hook:** classic idle-game "check back" compulsion, but paired with
  a genuinely satisfying tactile harvest animation (think Alto's Odyssey juice) instead
  of just a number going up. Rare mutant plant spawns create FOMO ("if I don't harvest in
  2 hours it wilts").
- **Meta-progression:** garden plots unlock, seed collection/dex, occasional trading with
  "neighbor" gardens (async, no live multiplayer needed).
- **Monetization:** cosmetic garden themes, "grow faster" ad boosts, seed pack IAP.
- **Build effort:** Medium-low. Very forgiving art bar (stylized, can start with simple
  shapes/procedural plant generation).

---

## 3. Overtime — 10-second reflex arcade, daily ladder

**Pitch:** A single, brutally simple reflex mechanic (e.g., tap to flip gravity and
dodge obstacles, à la Flappy Bird/Crossy Road) but every day the level layout is the
*same seed* for everyone, so every run is directly comparable — like Wordle for reflex
games.

- **Core loop:** one tap to start → 10–40 second run → die → see today's leaderboard
  position update live → "try again" (unlimited retries, only best score counts).
- **Hard-to-put-down hook:** daily seed = social competitiveness ("I beat my friend's
  score today") + a natural reason to reopen the app tomorrow for a fresh seed. Extremely
  low friction (single tap control) makes "just one more try" nearly free.
- **Meta-progression:** streak counter for playing daily, unlockable trail/character
  skins from cumulative daily wins.
- **Monetization:** rewarded-ad "practice mode" unlock, skins IAP.
- **Build effort:** Low. This is the fastest concept to prototype — could have a playable
  build in days.

---

## 4. Contraband — push-your-luck smuggler's run

**Pitch:** A "just one more delivery" risk game. You load a truck/backpack with illegal
goods, choosing how much to carry (more = more profit, more risk), then run a short
procedurally-generated gauntlet of checkpoints where you can bribe, hide, or bolt.

- **Core loop:** choose loadout (risk slider) → 20–45 sec run through checkpoints with
  quick decisions (bribe/hide/run, each a mini reflex or bluffing moment) → cash out or
  push further for a multiplier → bank profits or lose it all if caught.
- **Hard-to-put-down hook:** push-your-luck is one of the most reliably compulsive loop
  structures (dice games, Balatro's blind escalation, Duolingo's streak-risk). The
  "should I cash out now?" tension recreates itself every single run.
- **Meta-progression:** unlock better hiding spots/vehicles/bribery gadgets; a black-market
  upgrade tree between runs.
- **Monetization:** cosmetic vehicle skins, "insurance" IAP that protects one bust per day.
- **Build effort:** Medium. Needs a lightweight procedural checkpoint generator + decision
  UI, but no complex physics or art needs.

---

## 5. Echo Chamber — asynchronous social deduction, 2 min/day

**Pitch:** A tiny social party game you play with 4–6 friends asynchronously — each day
everyone submits one message (a lie, a truth, a guess) about a rotating daily prompt,
then results reveal at a set time, like a mashup of Wavelength and Among Us but
turn-based over a day instead of live.

- **Core loop:** open app once → read the daily prompt → submit your answer (10–20 sec)
  → later get a push notification when the group's results reveal → read reactions/laugh
  → done.
- **Hard-to-put-down hook:** built on social stickiness (this is "hard to put down" via
  FOMO on your friend group, not raw dopamine loop) — you don't want to be the one who
  didn't submit today. Push notification at reveal time creates a daily habitual re-open.
- **Meta-progression:** running stats per friend group (most creative liar, best guesser),
  streaks, seasonal prompt packs.
- **Monetization:** premium prompt packs, cosmetic profile badges.
- **Build effort:** Higher — needs a lightweight backend/server for group sync and push
  notifications, but very low art/animation needs.

---

## 6. Undertow — one-thumb endless diver with a real skill ceiling

**Pitch:** An endless "descend as deep as possible" game (like Downwell but diving
underwater) where the only control is thumb pressure/hold-release timing to dodge
currents and predators, rewarding genuine skill mastery rather than just RNG luck.

- **Core loop:** single hold-and-release control → dive deeper, dodging hazards that
  scroll faster the deeper you go → collect O2 pickups to extend the run → die → instant
  restart (no loading screen, <1 sec).
- **Hard-to-put-down hook:** skill-ceiling arcade games (Flappy Bird, Downwell,
  Crossy Road) create "I know exactly why I died and I can do better" — the most
  addictive kind of frustration. Zero-friction instant restart is critical.
- **Meta-progression:** depth milestones unlock new biomes/creature sets to look at,
  cosmetic diver skins, personal-best depth ghost to race against.
- **Monetization:** cosmetic skins, rewarded-ad "extra O2" continue.
- **Build effort:** Low-medium. Single mechanic, procedural hazard generation, strong
  focus on juice/game-feel (screen shake, particles, sound) to sell the skill loop.

---

## Which pattern to lean into

If the goal is *maximum* "hard to put down," the strongest addiction levers, ranked:

1. **Push-your-luck** (#4 Contraband) — proven in gambling/dice psychology, the tension
   never fades no matter how many times you play.
2. **Skill-ceiling arcade with instant restart** (#6 Undertow, #3 Overtime) — "one more
   try" friction is nearly zero, and mastery keeps it fresh far longer than pure RNG.
3. **Roguelike merge/deckbuilder** (#1 Splice) — best long-term retention (see Balatro),
   but bigger scope to build well.
4. **Idle/async social** (#2, #5) — great for daily-habit retention but the "fun in the
   moment" is lower-intensity; better as a second app in a portfolio than a first bet.

**My recommendation for a first build:** start with **#6 Undertow** or **#3 Overtime** —
smallest scope, fastest to a genuinely fun prototype, and reflex/skill games are the
easiest to validate "is this actually fun" within a week of work. Once the core loop
feels good, push-your-luck (#4) or merge-roguelike (#1) are the better bets for a
deeper, longer-retention follow-up.
