# Design influences — lessons from games that solved what we haven't

Reference analysis, not a feature backlog. Read alongside `PLAYTEST_FEEDBACK.md`.
The point is to steal *structural* answers, not to clone surface features.

---

## Boomerang Fu (2020, Cranky Watermelon)

A top-down arena brawler where cute food characters throw boomerangs at each
other. Chosen as a reference because it is extremely good at the exact thing
Rogue Tides was called "lame" for lacking: making you want one more round.

### The hard numbers

- **Average round: ~15 seconds.** Some end in 5–6 seconds.
- **Full match: 10–15 minutes**, made of many short rounds.
- One hit kills. No respawn within a round.
- Win condition: first to a kill threshold across the round series.

Compare Rogue Tides: no round, no match, no end state. A player sails into an
endless sandbox where nothing concludes. **This is the single biggest
structural gap** — not a missing feature, a missing *shape*.

### Lesson 1 — The core verb should contain its own risk (highest value)

In Boomerang Fu, **throwing your only weapon leaves you defenseless** until it
returns. Attack and vulnerability are the *same action*. That one decision
generates nearly all the game's tension, with no extra systems required.

Rogue Tides' core verb — fire cannons — currently has **no downside**. A
reload timer is a wait, not a risk. Nothing about firing makes you exposed.

The naval-history version of this mechanic is sitting right there: you fire a
broadside, and then that side is spent and you must *come about* to bring the
other guns to bear. Making a broadside a genuine commitment — the fired side
goes cold for a real window, and/or firing costs you speed/heel — would create
moment-to-moment tension without adding a single new system. It also
retroactively makes the port/starboard cannon-placement choice matter, which
today is nearly cosmetic.

### Lesson 2 — Give the session an arc: beginning, escalation, resolution

A Boomerang Fu match escalates: power-ups **stack and carry across rounds**,
so late rounds are gleeful chaos. There's a build-up and a payoff.

Rogue Tides is a flat line forever. But it is closer to fixing this than it
looks: the **unbanked-gold voyage** (leave port → build a hold → bank it or
lose it) is already a round in everything but name. Lean into that framing
explicitly — a *voyage* is the round. It has a start, rising tension as the
hold fattens, and a resolution (bank it, or sink and lose it).

Target: a satisfying voyage should resolve in well under a mobile session.
Boomerang Fu's whole match is 10–15 min; a Rogue Tides voyage should be
shorter than that.

### Lesson 3 — Pickups should transform, not increment

Boomerang Fu power-ups (fire, ice, teleport, wall-dash, multi-shot) **change
what you can do**, are instantly legible, and stack into combos.

Rogue Tides upgrades are `+2.2 speed`, `+6 damage` — invisible increments
bought in a menu. The genuinely transformative system it *does* have (ammo
types) is hidden behind unlabeled 1/2/3/4 buttons, which is exactly why the
owner said "just cut the option."

The strong version for Rogue Tides: **mid-voyage pickups that dramatically
change your ship for that voyage only, stacking as you go, lost when you
sink.** This pairs perfectly with unbanked gold — the longer you stay out, the
more powerful you get *and* the more you stand to lose. That's a self-
reinforcing escalation curve, and it's the same engine driving Boomerang Fu's
match arc.

### Lesson 4 — Readability is a mechanic

Boomerang Fu is instantly readable: who's who, where the danger is, who's
about to die. Its slow-motion on the final kill is *punctuation* — it tells you
that moment mattered.

Rogue Tides ships are small on screen, hard to tell apart, and carry no
at-a-glance state. You cannot tell if the ship you're chasing is nearly dead.
Hit-stop and camera shake already exist, but nothing marks a *significant*
kill differently from a trivial one. Sinking a player with a full hold should
feel categorically different from popping a tier-0 bot.

### Lesson 5 — Terrain should force interaction, not decorate

Boomerang Fu arenas are small and full of traps, hazards, foliage to hide in,
and pits — the space itself creates encounters and decisions.

Rogue Tides islands are, in the owner's words, "nubs popping out of the
ocean" — pure scenery. They should be tactical: shallows that block deep-draft
hulls, straits that funnel traffic into ambushes, reefs that punish careless
sailing, fog banks or coves to hide a loaded ship in. This is the same
complaint as "islands look bad" attacked from the gameplay side, and it makes
capturable ports far more interesting when they arrive.

### What deliberately does NOT transfer

Be careful — Boomerang Fu is a round-based arena party game with **zero
persistence**, and Rogue Tides is a persistent-progression world. Copying
blindly would break things:

- **One-hit kills**: far too punishing when death also costs your unbanked
  gold. TTK should probably come *down*, but not to one hit.
- **Full round reset / no persistence**: conflicts directly with the
  progression and banking model. Take the *arc*, not the wipe.
- **Tiny arena**: Rogue Tides wants a sense of voyage and exploration. The
  answer to the empty-world problem is **denser**, not **tiny**.
- **Couch-local immediacy**: Rogue Tides players may be alone in the world.
  Density of *bots* and world events has to carry the tension when no other
  player is nearby.

### Priority ranking for Rogue Tides

1. **Broadside commitment** (Lesson 1) — highest tension-per-line-of-code.
2. **Voyage as the session arc** (Lesson 2) — mostly free, given unbanked gold.
3. **Transformative mid-voyage pickups** (Lesson 3) — the escalation engine.
4. **Kill/state readability + significant-kill punctuation** (Lesson 4).
5. **Tactical terrain** (Lesson 5) — pairs with capturable ports.

### Sources

- https://www.nookgaming.com/boomerang-fu-review/
- https://www.nintendolife.com/reviews/switch-eshop/boomerang_fu
- https://wcrobinson.org/2024/01/25/boomerang-fu-review-why-it-should-be-your-new-go-to-party-game/
- https://gamingtrend.com/reviews/boomerang-fun-or-boomerang-fooey-boomerang-fu-review/
