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

export function generateIslands(islandCount: number, worldRadius: number): IslandInfo[] {
  const islands: IslandInfo[] = [{ x: 0, z: 0, radius: 22, isHomePort: true }];
  for (let i = 0; i < islandCount; i++) {
    const angle = (i / islandCount) * Math.PI * 2 + Math.random() * 0.5;
    const dist = 150 + Math.random() * (worldRadius - 150);
    const radius = 12 + Math.random() * 20;
    islands.push({ x: Math.cos(angle) * dist, z: Math.sin(angle) * dist, radius, isHomePort: false });
  }
  return islands;
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
