import { randomUUID } from 'node:crypto';
import type { IslandInfo } from '../../src/shared/protocol';

/** Plain-data port of World.ts's layout logic — island/crate positions only,
 * no THREE.js meshes. Visual mesh construction stays entirely client-side. */

export interface CrateState {
  id: string;
  x: number;
  z: number;
  value: number;
  collected: boolean;
}

/** Minimum clear water between two island shorelines, and between any island
 * and the home-port sanctuary — enough for a galleon to work through without
 * scraping, so denser islands add navigation texture rather than roadblocks. */
const ISLAND_CLEARANCE = 34;
const HOME_PORT_KEEP_OUT = 90;

/** How many islands become capturable outposts, and how far out they have to
 * sit. The distance floor matters mechanically, not just thematically: an
 * outpost's assault-trigger ring reaches `radius + 55` and the home sanctuary
 * reaches 67, so an outpost any closer than ~160 would let a player standing
 * in the safe ring poke a garrison awake and then duck back in. */
const OUTPOST_COUNT = 5;
const OUTPOST_MIN_HOME_DIST = 160;
const OUTPOST_NAMES = [
  'Gull Rock',
  'Blackreef',
  'Saltmarrow',
  'Cinder Cay',
  "Wrecker's Point",
  'Bone Atoll',
  'Gallows Shoal',
  'Rum Bight',
];

/** Islands used to sit on `islandCount` evenly-spaced angular spokes at
 * `150 + rand*(worldRadius-150)`, which is uniform in *radius* and therefore
 * heavily biased toward the centre in *area* — and left the whole inner disc
 * bare. Radius is now sqrt-distributed so islands are spread uniformly over
 * the water's actual area, with golden-angle spokes and a rejection test so
 * they don't pile up or overlap. */
export function generateIslands(islandCount: number, worldRadius: number): IslandInfo[] {
  const islands: IslandInfo[] = [
    { x: 0, z: 0, radius: 22, isHomePort: true, isOutpost: false, name: 'Home Port' },
  ];
  const inner = HOME_PORT_KEEP_OUT;
  const outer = Math.max(inner + 1, worldRadius - 25);
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < islandCount; i++) {
    const radius = 12 + Math.random() * 20;
    let placed = false;
    // 120 attempts, not 30: at 30 a ~1-in-300 world came up an island short
    // (measured), which would silently thin the map for whoever hit it.
    for (let attempt = 0; attempt < 120 && !placed; attempt++) {
      const angle = i * GOLDEN_ANGLE + (Math.random() - 0.5) * 0.9;
      // sqrt lerp between inner² and outer² == uniform density per unit area.
      const t = Math.random();
      const dist = Math.sqrt(inner * inner + t * (outer * outer - inner * inner));
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      if (dist < HOME_PORT_KEEP_OUT + radius) continue;
      if (islands.some((isl) => Math.hypot(isl.x - x, isl.z - z) < isl.radius + radius + ISLAND_CLEARANCE)) continue;
      islands.push({ x, z, radius, isHomePort: false, isOutpost: false, name: null });
      placed = true;
    }
  }
  designateOutposts(islands);
  return islands;
}

/** Promotes a spread of far-flung islands to capturable outposts. Picked by
 * walking the distance-sorted list of eligible islands at an even stride
 * rather than taking the N furthest: that guarantees one comparatively
 * approachable outpost for a stock sloop AND one deep in tier-3 water worth a
 * fully-kitted galleon, instead of a cluster all at the same difficulty. */
function designateOutposts(islands: IslandInfo[]) {
  const eligible = islands
    .filter((isl) => !isl.isHomePort && Math.hypot(isl.x, isl.z) >= OUTPOST_MIN_HOME_DIST)
    .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  if (eligible.length === 0) return;

  const count = Math.min(OUTPOST_COUNT, eligible.length, OUTPOST_NAMES.length);
  const stride = eligible.length / count;
  for (let i = 0; i < count; i++) {
    const island = eligible[Math.min(eligible.length - 1, Math.floor(i * stride))];
    island.isOutpost = true;
    island.name = OUTPOST_NAMES[i];
  }
}

export function spawnCrate(islands: IslandInfo[], worldRadius: number): CrateState {
  let x = 0;
  let z = 0;
  let attempts = 0;
  do {
    const angle = Math.random() * Math.PI * 2;
    const dist = 40 + Math.random() * (worldRadius - 40);
    x = Math.cos(angle) * dist;
    z = Math.sin(angle) * dist;
    attempts++;
  } while (islands.some((isl) => Math.hypot(isl.x - x, isl.z - z) < isl.radius + 8) && attempts < 20);
  return { id: randomUUID(), x, z, value: 10 + Math.floor(Math.random() * 20), collected: false };
}

/** Resolves a ship's position against island collisions in place, mirroring
 * the client's original resolveIslandCollisions. */
export function resolveIslandCollisions(
  islands: IslandInfo[],
  body: { x: number; z: number; speed: number },
  prevX: number,
  prevZ: number,
) {
  for (const isl of islands) {
    const dx = body.x - isl.x;
    const dz = body.z - isl.z;
    const dist = Math.hypot(dx, dz);
    const minDist = isl.radius + 2.5;
    if (dist < minDist) {
      if (dist < 0.001) {
        body.x = prevX;
        body.z = prevZ;
      } else {
        body.x = isl.x + (dx / dist) * minDist;
        body.z = isl.z + (dz / dist) * minDist;
      }
      body.speed *= 0.2;
    }
  }
}

export function homeSpawnPoint(): { x: number; z: number } {
  return { x: (Math.random() - 0.5) * 10, z: 45 + (Math.random() - 0.5) * 6 };
}
