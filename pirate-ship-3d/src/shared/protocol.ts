/** WebSocket wire protocol shared between the client and the authoritative
 * server. Plain data only — no THREE.js, no DOM — so this file can be
 * imported from both the browser bundle and the Node server unmodified. */

export interface InputState {
  turn: number;
  throttle: number;
  fire: boolean;
  boost: boolean;
  ammoType?: AmmoType;
}

/** Round shot is the free default; the other three are trade-offs (lower base
 * damage for a situational effect), not strictly-better upgrades. Chain in
 * particular cannot be spammed to lock a runner down: every foul builds
 * rigging resistance on the target, so it is a one-shot burst of closing
 * distance rather than a permanent leash. See CHAIN_* in GameRoom.ts. */
export type AmmoType = 'round' | 'chain' | 'grape' | 'fire';
export const AMMO_TYPE_ORDER: AmmoType[] = ['round', 'chain', 'grape', 'fire'];

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
  /** A capturable forward base — see OutpostInfo. Home port is never one. */
  isOutpost: boolean;
  /** Only outposts and the home port are named; plain scenery islands are null. */
  name: string | null;
}

/** A capturable forward base. Owning one gives you a second place to bank
 * your hold and open the shipyard, plus a tithe that accrues while you're
 * away — but an outpost is NOT a sanctuary: no damage immunity, in either
 * direction. That is the whole trade-off. Home port stays permanently
 * neutral, safe and available to everyone, so losing an outpost costs
 * convenience and never access. Per-player: `yours`/`tithe` are filled in
 * from the receiving client's point of view. */
export interface OutpostInfo {
  /** Index into the island list from the welcome message. */
  islandIndex: number;
  name: string;
  x: number;
  z: number;
  radius: number;
  /** Captain name of the current owner, or null while neutral. */
  ownerName: string | null;
  yours: boolean;
  /** How many garrison ships are still afloat; 0 means nobody is assaulting
   * it right now. Sink the last one and the outpost changes hands. */
  garrisonRemaining: number;
  /** Seconds until this outpost can be assaulted again (post-capture grace,
   * so a base can't be ping-ponged the moment it's taken). */
  lockedFor: number;
  /** Uncollected tithe waiting at this outpost — only non-zero for its owner.
   * Collected into the hold (and immediately banked) by docking. */
  tithe: number;
  tithePerMinute: number;
}

export interface CrateInfo {
  id: string;
  x: number;
  z: number;
  value: number;
}

/** Unbanked gold spilled by a sunk ship — floats for a fixed lifetime and can
 * be collected by ANY player, including the one who sank it. The killer gets
 * no automatic cut: they have to physically stop and scoop it up, which is
 * the trade-off that makes a kill a contested moment rather than a payout. */
export interface SalvageInfo {
  id: string;
  x: number;
  z: number;
  value: number;
  /** Whose hold this fell out of — flavour for "Captain X's spoils". */
  ownerName: string;
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
  /** An outpost garrison ship — spawned when someone starts an assault and
   * despawned when they give up. Always false for players. */
  isGarrison: boolean;
  shipClass: ShipClass;
  x: number;
  z: number;
  heading: number;
  speed: number;
  health: number;
  maxHealth: number;
  loadout: CannonLoadout;
  alive: boolean;
  /** Rigging shot out by chain shot — sail speed is cut until this clears. */
  sailDisabled: boolean;
  /** Hull alight from fire shot — ticking damage until this clears. */
  burning: boolean;
  /** Can neither deal nor take damage right now: inside the home-port
   * sanctuary, under post-respawn immunity, or a disconnected ghost ship.
   * Always false for bots. Worth rendering — otherwise players waste
   * broadsides on targets that can't be hurt. */
  protectedFromDamage: boolean;
}

export interface CannonballSnapshot {
  id: string;
  x: number;
  y: number;
  z: number;
  ammoType: AmmoType;
}

export interface EconomySnapshot {
  /** BANKED gold: safe forever, persisted, and the only currency the
   * shipyard accepts. Everything earned at sea lands in `hold` first. */
  gold: number;
  /** Unbanked gold "in the hold" — earned at sea, banked automatically the
   * moment you enter the home-port sanctuary, and spilled as salvage if you
   * sink first. Not persisted: it exists only while you're afloat. */
  hold: number;
  /** How much of `hold` would actually spill as collectable salvage if you
   * sank right now (the rest is destroyed). Precomputed server-side so the
   * HUD never has to duplicate the drop fraction. */
  holdAtRisk: number;
  /** Inside the home-port sanctuary: hold banks automatically and no damage
   * can be dealt or taken, by anyone, in either direction. */
  inSanctuary: boolean;
  /** Docked at an outpost you own. Banks the hold and opens the shipyard just
   * like home port does — but confers NO damage immunity, so you are refitting
   * with your guard down. */
  atOwnedOutpost: boolean;
  /** `inSanctuary || atOwnedOutpost` — the single flag the PORT button reads,
   * so "where can I shop" only ever has one definition. */
  canDock: boolean;
  /** How many outposts this captain currently holds. */
  outpostsOwned: number;
  /** Fire shot on the hull means no powder can be run to the sails: the boost
   * is locked out until the flames are out. The other half of fire's identity
   * besides damage-over-time, and the reason it is a chase answer that isn't
   * chain shot. */
  boostLocked: boolean;
  /** Seconds of post-respawn immunity left. Ends immediately if you fire, so
   * it can't be used as a shield to shoot from. */
  spawnProtection: number;
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
  /** 0-100 "wanted level" — rises on kills (much faster on PLAYER kills),
   * decays over time (fast near home port), periodically summons a hunter
   * ship when high, and makes bots preferentially target you. Session state,
   * not persisted across reconnects/logouts. */
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
  salvage: SalvageInfo[];
  /** Built per-recipient (the `yours`/`tithe` fields are viewer-relative). */
  outposts: OutpostInfo[];
  you: EconomySnapshot;
}

/** `for`, when present, means only that player's client should react to the
 * event (e.g. a personal "+gold" toast) — everyone else should ignore it. */
export type GameEvent =
  | { type: 'fire'; shipId: string; side: CannonSide }
  | { type: 'splash'; x: number; y: number; z: number }
  | { type: 'hit'; x: number; y: number; z: number; targetId: string; ownerId: string; damage: number }
  | { type: 'sunk'; shipId: string; x: number; z: number }
  | { type: 'ram'; x: number; y: number; z: number }
  | { type: 'gold'; amount: number; for: string }
  | { type: 'banked'; amount: number; for: string }
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
