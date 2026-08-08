import type { IslandInfo } from '../shared/protocol';

/** The single source of truth for an island's plan-view outline.
 *
 * Two systems need this shape and they used to disagree: World.ts wobbled its
 * terrain with `Math.random()` seeds (so no two clients — and no two islands —
 * agreed), while Ocean.ts drew its shore foam on a hand-copied approximation
 * of the same formula. The result was surf that didn't follow the beach, and
 * a "shared" world where the coastline was different on every machine.
 *
 * Everything here is derived deterministically from the island's server-sent
 * position, so every client builds the identical island, and the GLSL copy of
 * `coastlineShape` in Ocean.ts's fragment shader is the only duplication left
 * (unavoidable — it has to run per-pixel on the GPU).
 */

export interface CoastlineShape {
  /** Multiply by shape(angle) to get the waterline radius. Chosen so the
   * maximum over all angles is exactly IslandInfo.radius, which keeps the
   * visible land inside the server's collision radius. */
  scale: number;
  /** Phase seed for the three wobble harmonics. */
  phase: number;
  /** 0 = round, up to ~0.4 = strongly elongated. */
  elongation: number;
  /** World-space angle of the elongation's long axis. */
  axis: number;
  /** Which silhouette family this island uses (see World.ts). */
  archetype: number;
  /** Stable integer seed for all other per-island randomness. */
  seed: number;
}

/** Deterministic 32-bit hash of the island's position. */
function hashPosition(x: number, z: number): number {
  let h = 2166136261 >>> 0;
  const feed = (v: number) => {
    // Quantised so tiny float differences can't flip the hash.
    let n = Math.round(v * 16) | 0;
    for (let i = 0; i < 4; i++) {
      h ^= n & 0xff;
      h = Math.imul(h, 16777619) >>> 0;
      n >>>= 8;
    }
  };
  feed(x);
  feed(z);
  return h >>> 0;
}

/** mulberry32 — small, fast, and stable across engines. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const ARCHETYPE_VOLCANIC = 0;
export const ARCHETYPE_ATOLL = 1;
export const ARCHETYPE_MESA = 2;
export const ARCHETYPE_RIDGE = 3;
export const ARCHETYPE_CAY = 4;
export const ARCHETYPE_HOME = 5;

/** Raw outline multiplier at a given angle. Must stay identical to
 * `coastShape()` in Ocean.ts's fragment shader. */
export function coastlineShape(angle: number, phase: number, elongation: number, axis: number): number {
  const wobble =
    0.1 * Math.sin(angle * 3 + phase) +
    0.06 * Math.sin(angle * 5 + phase * 1.7) +
    0.035 * Math.sin(angle * 9 + phase * 2.3);
  return (1 + wobble) * (1 + elongation * Math.cos(2 * (angle - axis)));
}

/** Picks the archetype and outline parameters for a server-sent island. */
export function coastlineShapeParams(info: IslandInfo): CoastlineShape {
  const seed = hashPosition(info.x, info.z);
  const rnd = seededRandom(seed);
  const phase = rnd() * Math.PI * 2;
  const axis = rnd() * Math.PI * 2;

  let archetype: number;
  if (info.isHomePort) {
    archetype = ARCHETYPE_HOME;
  } else {
    // Size gates the silhouette families that make sense: a 12-unit rock
    // can't be a twin-peaked ridge, and a 40-unit landmass shouldn't be a
    // sandbar. Within a band the choice is still seeded, so neighbouring
    // islands of the same size still differ.
    const roll = rnd();
    if (info.radius < 16) {
      archetype = roll < 0.5 ? ARCHETYPE_CAY : ARCHETYPE_VOLCANIC;
    } else if (info.radius < 24) {
      archetype = roll < 0.34 ? ARCHETYPE_ATOLL : roll < 0.67 ? ARCHETYPE_MESA : ARCHETYPE_VOLCANIC;
    } else {
      archetype = roll < 0.3 ? ARCHETYPE_RIDGE : roll < 0.55 ? ARCHETYPE_MESA : roll < 0.8 ? ARCHETYPE_VOLCANIC : ARCHETYPE_ATOLL;
    }
  }

  // Long thin shapes read very differently from round ones at a glance, so
  // this is one of the cheapest sources of silhouette variety there is.
  const elongBase =
    archetype === ARCHETYPE_CAY ? 0.3 : archetype === ARCHETYPE_RIDGE ? 0.26 : archetype === ARCHETYPE_HOME ? 0.08 : 0.14;
  const elongation = elongBase * (0.5 + rnd());

  // Normalise so max(shape) === 1 and the land can never poke outside the
  // server's collision radius (which is `radius + 2.5`).
  let maxShape = 0;
  for (let i = 0; i < 256; i++) {
    const a = (i / 256) * Math.PI * 2;
    maxShape = Math.max(maxShape, coastlineShape(a, phase, elongation, axis));
  }

  return { scale: info.radius / maxShape, phase, elongation, axis, archetype, seed };
}

/** Waterline radius at a given angle. */
export function coastlineRadius(shape: CoastlineShape, angle: number): number {
  return shape.scale * coastlineShape(angle, shape.phase, shape.elongation, shape.axis);
}
