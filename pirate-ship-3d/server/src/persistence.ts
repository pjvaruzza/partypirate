import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CannonLoadout } from '../../src/shared/protocol';

/** Captain-name-keyed save file — trust-based identity for a small friend
 * group, no accounts/passwords. Debounced writes so a burst of purchases
 * doesn't hammer disk, plus a synchronous flush for clean shutdown. */

export interface PersistedEconomy {
  gold: number;
  sails: number;
  cannons: number;
  hull: number;
  powder: number;
  loadout: CannonLoadout;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', 'data', 'players.json');

function defaultEconomy(): PersistedEconomy {
  return { gold: 0, sails: 0, cannons: 0, hull: 0, powder: 0, loadout: { front: 0, left: 1, right: 1 } };
}

let cache: Record<string, PersistedEconomy> | null = null;

function loadAll(): Record<string, PersistedEconomy> {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    cache = {};
  }
  return cache as Record<string, PersistedEconomy>;
}

export function loadPlayer(name: string): PersistedEconomy {
  const all = loadAll();
  const existing = all[name];
  const merged: PersistedEconomy = {
    ...defaultEconomy(),
    ...existing,
    loadout: { ...defaultEconomy().loadout, ...existing?.loadout },
  };
  all[name] = merged;
  return merged;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function savePlayer(name: string, economy: PersistedEconomy) {
  const all = loadAll();
  all[name] = economy;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSync, 500);
}

export function flushSync() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const all = loadAll();
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(all, null, 2));
}
