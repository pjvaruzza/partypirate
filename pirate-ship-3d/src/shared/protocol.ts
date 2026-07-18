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

export type ShipClass = 'sloop' | 'brigantine' | 'galleon';
export const SHIP_CLASS_ORDER: ShipClass[] = ['sloop', 'brigantine', 'galleon'];
/** Visual scale per class — also used server-side for cannon mount offsets
 * and hit-radius so bigger ships are both bigger targets and have cannons
 * that visually line up with the bigger hull. */
export const SHIP_CLASS_SCALE: Record<ShipClass, number> = {
  sloop: 1,
  brigantine: 1.3,
  galleon: 1.6,
};

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

export interface ClientBuyClassMessage {
  type: 'buyClass';
}

export type ClientMessage =
  | ClientJoinMessage
  | ClientInputMessage
  | ClientBuyMessage
  | ClientLoadoutMessage
  | ClientChatMessage
  | ClientBuyClassMessage;

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
  /** A rare, tougher bot spawned as the payoff of a treasure-hunt chain —
   * always false for players. */
  isBoss: boolean;
  /** A named rival captain — an occasional, tougher/faster ambient encounter
   * distinct from the treasure-hunt boss chain. Always false for players. */
  isRival: boolean;
  shipClass: ShipClass;
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
  shipClass: ShipClass;
  /** null once already at the top class (galleon). */
  nextClass: ShipClass | null;
  nextClassCost: number | null;
  treasureHuntsCompleted: number;
  /** The dig site for this player's active treasure map, if any — only ever
   * sent to the player who owns it. */
  treasureHunt: { x: number; z: number } | null;
  /** 0-100 "wanted level" — rises on kills, decays over time (fast near
   * home port), and periodically summons a hunter ship when high. Session
   * state, not persisted across reconnects/logouts. */
  heat: number;
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
  | { type: 'hit'; x: number; y: number; z: number; targetId: string; ownerId: string; damage: number }
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
