# Playtest feedback — MANDATORY READING for every agent

This is real feedback from the project owner after actually playing the build,
not a synthetic checklist. Every agent must read this before starting work and
must weigh its own output against it. It supersedes any assumption that
previously-shipped work in this area is "done."

## The meta-lesson: our verification has been insufficient

Three separate visual passes shipped this project. Each one fixed real,
measurable defects (a hole in the stern geometry, a shadow-map smear, a
mis-scaled waterline). Each was verified rigorously. After all three, the
owner's verdict was still: **"graphics still suck."**

The verification wasn't wrong — it was answering the wrong question. It
asked *"did my change do what I intended?"* and never *"is the result
actually good?"* Those are different bars, and only the second one matters
to a player.

**Therefore, for every agent, on every run:**

1. **Judge the whole frame, not your diff.** After your change, look at the
   result as a player seeing it for the first time. Would someone screenshot
   this? Would they keep playing? If your fix is correct but the thing it's
   part of is still mediocre, say so explicitly in your report instead of
   declaring victory on the narrow fix.
2. **A defect-free mediocre system is still mediocre.** If a system's
   *ceiling* is the problem (flat water, one island shape, a shallow loop),
   polishing it is wasted work. Escalate or rebuild — don't sand it smoother.
3. **"Verified" ≠ "good."** Keep the measurement rigor (it has caught real
   regressions others missed), but never let a green check substitute for
   an aesthetic or design judgment.
4. **Be critical of prior work, including your own predecessors'.** Several
   items below were previously marked `[x]` in ROADMAP.md. They are not done.

## The feedback, verbatim, with grounding

### 1. World is far too spread out
> "map is too spread out. takes forever to get anywhere. either shrink map
> or increase speed."

Grounded: `worldRadius = 900`, fresh-sloop `topSpeed = 6` units/sec.
Center-to-edge is 150s; a full crossing is ~5 minutes. This game targets
**5-15 minute mobile sessions** — one traversal currently consumes the whole
session. This is a fundamental scale error, not a tuning nit.

### 2. Ammo types communicate nothing
> "the different types of ammo are unclear. just 1,2,3,4 doesnt say anything
> about whats the difference, if there are advantages, etc. if there isnt,
> just cut the option"

The trade-offs are real and precisely tuned server-side (chain fouls rigging,
grape rewards close range, fire applies DoT) — but **none of it is visible to
the player**, so functionally it doesn't exist. Note the owner's instinct: a
mechanic you can't explain in the UI may as well be cut. Surface it or lose it.

### 3. World feels empty
> "not enough enemy ships... for now theres no one around"

Grounded: `MAX_ENEMIES = 6` across π·900² ≈ 2.54M square units — roughly one
enemy per 424,000 sq units. The world is not sparse by accident; it's sparse
by construction.

### 4. Graphics still suck (THIRD TIME RAISED)
> "The water just keeps showing wavy blue color gradient. doesnt really add
> much. Islands are just nubs popping out of the ocean"

This is not a defect report — it's a verdict on ambition. Water with no
depth-based color, no crest foam, no ship wakes, no sun glitter, no fresnel
reflection reads as a moving gradient. Islands built from one hill silhouette
scaled N ways read as nubs. **Polishing these further will not work. They need
to be materially more ambitious.**

### 5. Home port is too far / accessibility
> "home base is far away. think about ways to let player access shipyard
> slightly more easily. Maybe taking over another persons base?"

The owner's own suggestion is a strong one and worth taking seriously:
capturable ports would simultaneously fix traversal pain (#1), give islands a
purpose (#4), create territorial stakes, and give multiplayer real meaning (#6).
One mechanic, four problems.

### 6. Core loop is shallow (the deepest problem)
> "overall game play is lame. like is it just that you go around shooting
> others? dig deeper to add more creativity and think about what needs to be
> true to make this addictive for multiplayers"

Adding a fifth mechanic to an unexamined loop will not fix this. The current
loop is: sail → shoot bot → collect gold → sail to port → upgrade → repeat.
There is **nothing at stake** (death costs you nothing), **no player
interaction** that matters, **no session goal**, and **no reason to return**.
Interrogate the loop itself before proposing features.

### 7. Raise the bar
> "take all this feedback and make sure the agents hear it. Be extra critical
> and drive the highest quality results."

## Standing instruction

If a brief you're given would produce another narrow, technically-correct fix
to something the owner has already rejected twice, **say so and propose the
more ambitious version instead** of quietly doing the small thing well.
