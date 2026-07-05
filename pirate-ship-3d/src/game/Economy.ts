import type { ShipStats, CannonSide, CannonLoadout } from './Ship';

export type UpgradeKey = 'sails' | 'cannons' | 'hull' | 'powder';
export type { CannonSide, CannonLoadout };

export interface EconomyState {
  gold: number;
  sails: number;
  cannons: number;
  hull: number;
  powder: number;
  loadout: CannonLoadout;
}

const STORAGE_KEY = 'rogue-tides-save-v1';

const BASE_COST: Record<UpgradeKey, number> = {
  sails: 40,
  cannons: 50,
  hull: 45,
  powder: 60,
};

const COST_GROWTH = 1.55;
export const MAX_LEVEL = 6;

export const BASE_CANNON_SLOTS = 2;
export const SIDE_SLOT_MAX = 4;
export const FRONT_SLOT_MAX = 2;

function defaultState(): EconomyState {
  return { gold: 0, sails: 0, cannons: 0, hull: 0, powder: 0, loadout: { front: 0, left: 1, right: 1 } };
}

export class Economy {
  state: EconomyState;

  constructor() {
    this.state = this.load();
  }

  private load(): EconomyState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return { ...defaultState(), ...parsed, loadout: { ...defaultState().loadout, ...parsed.loadout } };
    } catch {
      return defaultState();
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // storage unavailable, ignore
    }
  }

  addGold(amount: number) {
    this.state.gold += amount;
    this.save();
  }

  costFor(key: UpgradeKey): number {
    const level = this.state[key];
    return Math.round(BASE_COST[key] * Math.pow(COST_GROWTH, level));
  }

  canAfford(key: UpgradeKey): boolean {
    return this.state[key] < MAX_LEVEL && this.state.gold >= this.costFor(key);
  }

  buy(key: UpgradeKey): boolean {
    if (!this.canAfford(key)) return false;
    this.state.gold -= this.costFor(key);
    this.state[key] += 1;
    this.save();
    return true;
  }

  shipStats(): ShipStats {
    return {
      sailLevel: this.state.sails,
      cannonLevel: this.state.cannons,
      hullLevel: this.state.hull,
    };
  }

  powderKegCharges(): number {
    return this.state.powder;
  }

  totalCannonSlots(): number {
    return BASE_CANNON_SLOTS + this.state.cannons;
  }

  assignedCannonSlots(): number {
    const { front, left, right } = this.state.loadout;
    return front + left + right;
  }

  unassignedCannonSlots(): number {
    return this.totalCannonSlots() - this.assignedCannonSlots();
  }

  private sideMax(side: CannonSide): number {
    return side === 'front' ? FRONT_SLOT_MAX : SIDE_SLOT_MAX;
  }

  canIncrementSlot(side: CannonSide): boolean {
    return this.unassignedCannonSlots() > 0 && this.state.loadout[side] < this.sideMax(side);
  }

  canDecrementSlot(side: CannonSide): boolean {
    return this.state.loadout[side] > 0;
  }

  incrementSlot(side: CannonSide): boolean {
    if (!this.canIncrementSlot(side)) return false;
    this.state.loadout[side] += 1;
    this.save();
    return true;
  }

  decrementSlot(side: CannonSide): boolean {
    if (!this.canDecrementSlot(side)) return false;
    this.state.loadout[side] -= 1;
    this.save();
    return true;
  }

  loadout(): CannonLoadout {
    return { ...this.state.loadout };
  }
}
