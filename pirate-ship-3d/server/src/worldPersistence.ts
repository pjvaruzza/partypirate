import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IslandInfo } from '../../src/shared/protocol';

/** World state that must survive a server restart.
 *
 * `persistence.ts` keeps *per-captain* economy; this keeps the things that
 * belong to the world rather than to any one player. Two of them:
 *
 *  1. **The island layout.** Islands are randomly generated at boot, so
 *     without this a restart would shuffle the map — and outpost ownership
 *     keyed to an island index would land on a different rock. Persisting the
 *     layout is what makes "the world I left is the world I come back to"
 *     literally true, which is the point of owning territory at all.
 *  2. **Outpost ownership and the uncollected tithe.** This is the whole
 *     come-back-tomorrow hook: your base is still yours in the morning, and
 *     there is a pile of gold sitting on it.
 *
 * Same trust-based, no-accounts model as the player file, same debounced
 * writes. `ROGUE_TIDES_DATA_DIR` overrides the location so tests can run
 * hermetically instead of scribbling on a live save.
 */

export interface PersistedOutpost {
  islandIndex: number;
  name: string;
  ownerName: string | null;
  tithe: number;
}

export interface PersistedWorld {
  worldRadius: number;
  islands: IslandInfo[];
  outposts: PersistedOutpost[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.ROGUE_TIDES_DATA_DIR ?? path.join(__dirname, '..', 'data');
const WORLD_FILE = path.join(DATA_DIR, 'world.json');

/** Returns null when there is no usable save, or when the saved world doesn't
 * match the shape the server is being asked for (e.g. the world radius was
 * retuned between builds) — in which case the caller regenerates from
 * scratch, which is the right answer rather than sailing a stale map. */
export function loadWorld(worldRadius: number): PersistedWorld | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf-8')) as PersistedWorld;
    if (!parsed || parsed.worldRadius !== worldRadius) return null;
    if (!Array.isArray(parsed.islands) || parsed.islands.length === 0) return null;
    if (!parsed.islands.some((isl) => isl.isHomePort)) return null;
    if (!Array.isArray(parsed.outposts)) return null;
    return parsed;
  } catch {
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pending: PersistedWorld | null = null;

export function saveWorld(world: PersistedWorld) {
  pending = world;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushWorldSync, 500);
}

export function flushWorldSync() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!pending) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(WORLD_FILE, JSON.stringify(pending, null, 2));
}
