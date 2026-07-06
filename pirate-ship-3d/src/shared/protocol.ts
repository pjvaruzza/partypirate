/** WebSocket wire protocol shared between the client and the authoritative
 * server. Plain data only — no THREE.js, no DOM — so this file can be
 * imported from both the browser bundle and the Node server unmodified. */

export interface InputState {
  turn: number;
  throttle: number;
  fire: boolean;
  boost: boolean;
}

export interface CannonLoadout {
  front: number;
  left: number;
  right: number;
}

export type CannonSide = 'front' | 'left' | 'right';
export type UpgradeKey = 'sails' | 'cannons' | 'hull' | 'powder';

export interface ClientJoinMessage {
  type: 'join';
  name: string;
}

export interface ClientInputMessage {
  type: 'input';
  input: InputState;
}

export interface ClientBuyMessage {
  type: 'buy';
  key: UpgradeKey;
}

export interface ClientLoadoutMessage {
  type: 'loadout';
  side: CannonSide;
  delta: 1 | -1;
}

export interface ClientChatMessage {
  type: 'chat';
  text: string;
}

export type ClientMessage =
  | ClientJoinMessage
  | ClientInputMessage
  | ClientBuyMessage
  | ClientLoadoutMessage
  | ClientChatMessage;

export interface IslandInfo {
  x: number;
  z: number;
  radius: number;
  isHomePort: boolean;
}

export interface CrateInfo {
  id: string;
  x: number;
  z: number;
  value: number;
}

export interface ShipSnapshot {
  id: string;
  name: string;
  isBot: boolean;
  x: number;
  z: number;
  heading: number;
  speed: number;
  health: number;
  maxHealth: number;
  loadout: CannonLoadout;
  alive: boolean;
}

export interface CannonballSnapshot {
  id: string;
  x: number;
  y: number;
  z: number;
}

export interface EconomySnapshot {
  gold: number;
  sails: number;
  cannons: number;
  hull: number;
  powder: number;
  loadout: CannonLoadout;
  costs: Record<UpgradeKey, number>;
  maxed: Record<UpgradeKey, boolean>;
  totalCannonSlots: number;
  assignedCannonSlots: number;
}

export interface WelcomeMessage {
  type: 'welcome';
  yourId: string;
  worldRadius: number;
  islands: IslandInfo[];
}

export interface StateMessage {
  type: 'state';
  ships: ShipSnapshot[];
  cannonballs: CannonballSnapshot[];
  crates: CrateInfo[];
  you: EconomySnapshot;
}

/** `for`, when present, means only that player's client should react to the
 * event (e.g. a personal "+gold" toast) — everyone else should ignore it. */
export type GameEvent =
  | { type: 'fire'; shipId: string; side: CannonSide }
  | { type: 'splash'; x: number; y: number; z: number }
  | { type: 'hit'; x: number; y: number; z: number; targetId: string }
  | { type: 'sunk'; shipId: string; x: number; z: number }
  | { type: 'gold'; amount: number; for: string }
  | { type: 'message'; text: string; duration?: number; for?: string }
  | { type: 'chat'; name: string; text: string };

export interface EventsMessage {
  type: 'events';
  events: GameEvent[];
}

export type ServerMessage = WelcomeMessage | StateMessage | EventsMessage;

export const MAX_LEVEL = 6;
export const BASE_CANNON_SLOTS = 2;
export const SIDE_SLOT_MAX = 4;
export const FRONT_SLOT_MAX = 2;
