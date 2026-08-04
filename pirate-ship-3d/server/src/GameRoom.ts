import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  applyControls,
  cannonDamage,
  cannonReload,
  integrate,
  maxHealthFor,
  topSpeed,
  type ShipBody,
  type ShipStats,
} from './ShipSim';
import { generateIslands, homeSpawnPoint, resolveIslandCollisions, spawnCrate, type CrateState } from './WorldGen';
import { spawnCannonballs, updateBotAI, updateCannonball, type BotAiState, type CannonballState } from './CombatSim';
import { savePlayer, type PersistedEconomy } from './persistence';
import {
  FRONT_SLOT_MAX,
  MAX_LEVEL,
  SHIP_CLASS_ORDER,
  SHIP_CLASS_SCALE,
  SIDE_SLOT_MAX,
  type AmmoType,
  type CannonLoadout,
  type CannonSide,
  type EconomySnapshot,
  type GameEvent,
  type IslandInfo,
  type InputState,
  type ShipClass,
  type UpgradeKey,
} from '../../src/shared/protocol';

/** World scale, sized against a concrete target rather than inherited from
 * the single-player prototype: **a full map crossing in ~90 seconds on a
 * fresh sloop** (~40s fully upgraded), so a 5-15 minute mobile session fits
 * several complete out-and-back runs instead of one commute.
 *
 *   2 * 400 / 9 = 88.9s crossing on a stock sloop (topSpeed 9)
 *   400 / 9     = 44.4s centre-to-edge
 *   2 * 250 / 9 = 55.6s for a mid-band raid and back to port
 *
 * The old 900 radius against a 6 unit/sec starting speed was 300s edge to
 * edge. This is the change that makes banking unbanked gold a tense decision
 * rather than a punishment. */
export const DEFAULT_WORLD_RADIUS = 400;
export const DEFAULT_ISLAND_COUNT = 18;
const CRATE_COUNT = 24;

/** Enemy density, also sized against a target: **something worth reacting to
 * roughly every ~20 seconds of open sailing.** A bot notices you at
 * DETECT_RANGE = 90, so a player at 9 units/sec sweeps a corridor
 * 180 units wide at 1620 sq units/sec. Over π*400² = 502,655 sq units of
 * water, N bots give a mean gap of 502655 / (1620 * N) seconds:
 *
 *   N =  6 (the old value, in the old 2.54M sq unit world): 261s  <- "theres no one around"
 *   N = 14 (this value, in this world):                      22.2s
 *
 * Bots are capped globally, but the cap scales with population so a busier
 * server doesn't feel thinner per-player. Solo: 10 + 4 = 14, matching the
 * arithmetic above. */
const ENEMY_BASE_COUNT = 10;
const ENEMY_PER_PLAYER = 4;
const ENEMY_MAX_COUNT = 22;
const ENEMY_SPAWN_INTERVAL = 5;
const CRATE_RESPAWN_DELAY = 15000;
const PLAYER_RESPAWN_DELAY = 3;
const BOT_DESPAWN_DELAY = 2.5;
const BOOST_DURATION = 4;
const BOOST_RECHARGE_TIME = 12;
const HIT_RADIUS = 3;
/** Ramming: driving your hull into another ship at speed damages both sides —
 * rewards aggressive close-range play as an alternative to broadsides.
 * Tighter than HIT_RADIUS (which is deliberately forgiving for cannon aim)
 * since this is meant to read as literal hull contact. */
const RAM_CONTACT_RADIUS = 1.6;
const RAM_MIN_SPEED = 3.5;
const RAM_DAMAGE_PER_SPEED = 2.6;
const RAM_MAX_DAMAGE = 45;
const RAM_COOLDOWN = 1.2;
const RAM_KNOCKBACK_SPEED_MULT = 0.3;
const CRATE_RADIUS = 3.2;
const RECONNECT_GRACE_MS = 60_000;
const CHAT_MAX_LENGTH = 140;
const TREASURE_MAP_DROP_CHANCE = 0.25;
const TREASURE_DIG_RADIUS = 6;
const TREASURE_BASE_REWARD = 200;
const TREASURE_REWARD_PER_HUNT = 50;
const TREASURE_REWARD_CAP = 600;
/** Every Nth completed treasure hunt spawns a boss instead of just paying out. */
const BOSS_INTERVAL = 5;
const BOSS_NAMES = ["The Kraken's Bane", "Widow's Reckoning", 'The Crimson Leviathan', 'Ghost of the Abyss'];
/** Bosses reload faster and tolerate a wider firing angle than regular bots;
 * both get more extreme once they drop below the enrage health threshold. */
const BOSS_FIRE_WINDOW_DEG = 55;
const BOSS_ENRAGED_FIRE_WINDOW_DEG = 75;
const BOSS_RELOAD_MULT = 0.8;
const BOSS_ENRAGED_RELOAD_MULT = 0.45;
const BOSS_ENRAGE_HEALTH_FRACTION = 0.35;

/** Occasional unique mini-boss encounters — distinct from the treasure-hunt
 * boss chain, these roam the world ambiently and are meaningfully tougher/
 * faster than a same-tier regular bot, with a name and signature look. */
const RIVAL_CHECK_INTERVAL = 45;
const RIVAL_SPAWN_CHANCE = 0.35;
const MAX_ACTIVE_RIVALS = 2;
const RIVAL_NAMES = [
  'Calico Jack Rackham',
  'One-Eyed Beatrix',
  'Blackscar Morrow',
  'Iron Hand Ilse',
  'Mad Dog McCready',
  'Silver-Tongued Solari',
];
const RIVAL_HEALTH_MULT = 1.6;
const RIVAL_RELOAD_MULT = 0.85;
const RIVAL_FIRE_WINDOW_DEG = 48;
const RIVAL_GOLD_MULT = 3;
const RIVAL_SAIL_BONUS = 1.5;

/** How bot/rival difficulty tier scales with spawn distance from home port.
 * A prior pass deliberately widened the tier-0 band to ~25% of spawns, so
 * that a first-time player's *nearest* fight is winnable on a stock sloop
 * (tier 1+ HP outpaces the reload-speed edge a fresh ship has). That intent
 * is preserved here, but the step is now DERIVED from the spawn range
 * instead of being a magic 190 that silently rescales with worldRadius:
 * four equal quarter-bands means tier 0/1/2/3 each get exactly 25% of
 * spawns at ANY world size, and tier 4 stays reserved for bosses.
 *
 *   worldRadius 400 -> spawn range [120, 370], step 62.5
 *   tier 0: [120.0, 182.5)  25%
 *   tier 1: [182.5, 245.0)  25%
 *   tier 2: [245.0, 307.5)  25%
 *   tier 3: [307.5, 370.0]  25%
 *
 * BOT_TIER_MIN_DIST also doubles as a bot-free approach lane around port —
 * 120 units of clear water so a loaded ship's last leg home isn't an ambush
 * gauntlet, which matters far more now that the hold can be lost. */
const BOT_TIER_MIN_DIST = 120;
const BOT_SPAWN_EDGE_MARGIN = 30;
function tierForDistance(dist: number, step: number): number {
  return Math.min(4, Math.max(0, Math.floor((dist - BOT_TIER_MIN_DIST) / step)));
}

/** --- Unbanked gold ------------------------------------------------------
 * Gold earned at sea sits in the hold (`PlayerShip.hold`) until you reach
 * port, which banks it permanently. Sink first and most of it spills as
 * floating salvage anyone can collect. This is the tension the whole loop
 * hangs on: every extra minute out makes your hold fatter, makes you a
 * better target, and sharpens the keep-hunting-vs-run-for-port call.
 *
 * 70/30 rather than a clean 100% drop: some of the hoard must be *destroyed*
 * on every sinking, or gold is merely conserved and dying costs the world
 * nothing. The 30% burn means the ocean's unbanked wealth decays steadily,
 * which is the pressure that pushes players to bank rather than to keep
 * trading kills in a closed loop.
 *
 * The killer gets NO automatic cut — they have to physically stop and scoop
 * it up, and a fat hold scatters into more chunks, so the richer the target
 * the longer the looter is parked and exposed. That turns a kill into a
 * contested scramble a third party can crash, rather than a clean payout. */
const SALVAGE_DROP_FRACTION = 0.7;
const SALVAGE_LIFETIME = 45;
const SALVAGE_GOLD_PER_CHUNK = 60;
const SALVAGE_MAX_CHUNKS = 5;
/** Chunks are scattered on a ring around the wreck, never clustered on it,
 * and the geometry is chosen so no two can ever sit inside one pickup
 * diameter. The binding case is the 5-chunk cap: nominal angular spacing
 * 2π/5 = 1.2566 rad, minus the full SALVAGE_SCATTER_JITTER spread, leaves a
 * worst-case 0.9566 rad gap; at the minimum ring radius that's a chord of
 *
 *   2 * 12 * sin(0.9566 / 2) = 11.05 units  >  2 * 4.5 = 9 unit pickup diameter
 *
 * so scooping a fat hold is genuinely several separate passes, and the
 * looter is parked and exposed for proportionally longer. (An earlier
 * radius of 9 * [0.35, 1.0] with 0.7 jitter failed this: a 20k-drop Monte
 * Carlo found chunks 4.24 units apart, i.e. two-for-one pickups.) */
const SALVAGE_SCATTER_RADIUS = 12;
const SALVAGE_SCATTER_SPREAD = 0.35;
const SALVAGE_SCATTER_JITTER = 0.3;
const SALVAGE_PICKUP_RADIUS = 4.5;

/** --- PvP safety ---------------------------------------------------------
 * Open PvP anywhere EXCEPT a sanctuary ring around home port, where no
 * damage flows in *either* direction. Making it symmetric is the point: a
 * one-way shield would just be a sniper nest you could camp. Max cannon
 * range is ~36 units (26 u/s muzzle speed, ~1.4s flight), so a 22+45 = 67
 * unit sanctuary can't be shot into from outside it, or out of from the
 * island itself.
 *
 * Respawn immunity covers the case of leaving the ring immediately after a
 * death, and ends the instant you fire — you can't shoot from behind it. */
const PORT_SANCTUARY_EXTRA = 45;
const SPAWN_PROTECTION_TIME = 6;

/** Ammo types are trade-offs, not upgrades — each deals less base damage
 * than round shot in exchange for a situational effect, so round shot stays
 * the correct default rather than something special ammo strictly beats. */
const CHAIN_DAMAGE_MULT = 0.5;
const CHAIN_RELOAD_MULT = 1.3;
const CHAIN_DISABLE_DURATION = 3.5;
const CHAIN_SPEED_MULT = 0.35;
/** ball.age at impact stands in for "how close was the target when fired" —
 * grape is a close-range shotgun blast, weak at range. */
const GRAPE_CLOSE_AGE = 0.5;
const GRAPE_CLOSE_DAMAGE_MULT = 1.6;
const GRAPE_FAR_DAMAGE_MULT = 0.6;
const FIRE_INITIAL_DAMAGE_MULT = 0.4;
const FIRE_DOT_TOTAL_MULT = 0.7;
const FIRE_DURATION = 4;
const FIRE_TICK_INTERVAL = 1;

const HEAT_MAX = 100;
const HEAT_PER_GOLD_EARNED = 0.15;
const HEAT_DECAY_PER_SEC = 1.2;
const HEAT_DECAY_PER_SEC_AT_PORT = 20;
const HUNTER_CHECK_INTERVAL = 12;
const HUNTER_SPAWN_CHANCE_AT_MAX_HEAT = 0.5;
/** Sinking another captain is the villain move, so it heats you far harder
 * than any bot kill: three player kills (105) tops out the wanted level,
 * which both summons hunters and makes every bot in range prefer you as a
 * target. Prey on people and the world starts preying on you. */
const HEAT_PER_PLAYER_KILL = 35;
/** How much a hot player outweighs proximity in bot target selection: at
 * HEAT_MAX a bot will chase you over a cold player up to 2x closer. This is
 * what stops bots being farmable cover — you can't hide behind one once
 * you're the most wanted ship on the water. */
const BOT_HEAT_ATTRACTION = 1.0;

const BASE_COST: Record<UpgradeKey, number> = { sails: 40, cannons: 50, hull: 45, powder: 60 };
const COST_GROWTH = 1.55;

/** Ship class base cannon slots, one-time upgrade cost, and stat bonuses —
 * bonuses are expressed as "free levels" folded into the existing
 * sailLevel/hullLevel formulas so ShipSim.ts needs no changes. */
const SHIP_CLASS_CONFIG: Record<ShipClass, { baseSlots: number; cost: number; hullLevelBonus: number; sailLevelBonus: number }> = {
  sloop: { baseSlots: 2, cost: 0, hullLevelBonus: 0, sailLevelBonus: 0 },
  brigantine: { baseSlots: 4, cost: 900, hullLevelBonus: 1.5, sailLevelBonus: 0.75 },
  galleon: { baseSlots: 6, cost: 3000, hullLevelBonus: 3.5, sailLevelBonus: 1.5 },
};

function statsForEconomy(economy: PersistedEconomy): ShipStats {
  const bonus = SHIP_CLASS_CONFIG[economy.shipClass];
  return {
    sailLevel: economy.sails + bonus.sailLevelBonus,
    cannonLevel: economy.cannons,
    hullLevel: economy.hull + bonus.hullLevelBonus,
  };
}

interface BaseShip {
  id: string;
  name: string;
  body: ShipBody;
  stats: ShipStats;
  loadout: CannonLoadout;
  health: number;
  maxHealth: number;
  cannonCooldown: number;
  alive: boolean;
  deathTimer: number;
  /** Prevents ram damage from re-triggering every tick while two hulls stay
   * in contact — see resolveRamming. */
  ramCooldown: number;
  /** Chain-shot rigging damage: sail speed is capped while this counts down —
   * see CHAIN_* constants and updateStatusEffects. */
  sailDisableTimer: number;
  /** Fire-shot ignition: ticks burnDamagePerTick every burnTickTimer seconds
   * until this reaches 0 — see FIRE_* constants and updateStatusEffects. An
   * integer tick counter rather than a duration so the last tick can't get
   * lost to float drift between two independently-decrementing timers. */
  burnTicksRemaining: number;
  burnTickTimer: number;
  burnDamagePerTick: number;
  /** Who lit the fire, so a burn-tick kill still credits gold/heat like a
   * normal cannonball kill — see killShip. */
  burnOwnerId: string | null;
}

export interface PlayerShip extends BaseShip {
  isBot: false;
  socket: WebSocket;
  input: InputState;
  economy: PersistedEconomy;
  /** Unbanked gold. Everything earned at sea lands here; entering the port
   * sanctuary moves it into `economy.gold` (banked, persisted, and the only
   * currency the shipyard accepts). Sinking spills most of it as salvage —
   * see dropSalvage. Deliberately NOT persisted: the hold is a per-voyage
   * stake, and making it survive a logout would defeat the point. */
  hold: number;
  /** Seconds of post-respawn damage immunity remaining; cleared the moment
   * the player fires — see updatePlayer / isProtected. */
  spawnProtection: number;
  boostCharge: number;
  boostTimer: number;
  boostRechargeTimer: number;
  /** Set while the socket is disconnected; the ship sits frozen in the world
   * for RECONNECT_GRACE_MS so the same captain name can reclaim it instead
   * of respawning fresh at port. */
  disconnectedAt: number | null;
  /** 0-100 "wanted level" — session-only, not persisted. See updateHeat. */
  heat: number;
  hunterCheckTimer: number;
}

export interface BotShip extends BaseShip {
  isBot: true;
  isBoss: boolean;
  /** A named rival captain — see RIVAL_NAMES / spawnRivalCaptain. Mutually
   * exclusive with isBoss. */
  isRival: boolean;
  /** One-way flip when a boss drops below BOSS_ENRAGE_HEALTH_FRACTION — see updateBot. */
  enraged: boolean;
  ai: BotAiState;
  goldReward: number;
}

export type AnyShip = PlayerShip | BotShip;

/** A floating pile of spilled hold gold — see SALVAGE_* above. */
export interface SalvageState {
  id: string;
  x: number;
  z: number;
  value: number;
  ownerName: string;
  ttl: number;
}

export class GameRoom {
  readonly worldRadius: number;
  readonly islands: IslandInfo[];
  crates: CrateState[] = [];
  cannonballs: CannonballState[] = [];
  salvage: SalvageState[] = [];
  ships = new Map<string, AnyShip>();
  events: GameEvent[] = [];

  private enemySpawnTimer = 0;
  private rivalSpawnTimer = 0;

  constructor(worldRadius = DEFAULT_WORLD_RADIUS, islandCount = DEFAULT_ISLAND_COUNT) {
    this.worldRadius = worldRadius;
    this.islands = generateIslands(islandCount, worldRadius);
    for (let i = 0; i < CRATE_COUNT; i++) this.crates.push(spawnCrate(this.islands, worldRadius));
    for (let i = 0; i < ENEMY_BASE_COUNT; i++) this.spawnBotWave();
  }

  /** Bot population target, scaled with connected players so a busier server
   * doesn't feel emptier per captain — see ENEMY_* above for the arithmetic
   * tying this to a ~20s mean encounter gap. */
  private maxEnemies(): number {
    let players = 0;
    for (const s of this.ships.values()) if (!s.isBot && s.disconnectedAt === null) players++;
    return Math.min(ENEMY_MAX_COUNT, ENEMY_BASE_COUNT + ENEMY_PER_PLAYER * players);
  }

  /** Bots spawn in an annulus [BOT_TIER_MIN_DIST, worldRadius - margin]; the
   * tier bands are quarters of this range — see tierForDistance. */
  private botSpawnRange(): number {
    return Math.max(4, this.worldRadius - BOT_TIER_MIN_DIST - BOT_SPAWN_EDGE_MARGIN);
  }

  private botTierStep(): number {
    return this.botSpawnRange() / 4;
  }

  addPlayer(id: string, name: string, socket: WebSocket, economy: PersistedEconomy): PlayerShip {
    const spawn = homeSpawnPoint();
    const stats = statsForEconomy(economy);
    const ship: PlayerShip = {
      id,
      name,
      isBot: false,
      body: { x: spawn.x, z: spawn.z, heading: Math.PI, speed: 0 },
      stats,
      loadout: { ...economy.loadout },
      health: maxHealthFor(stats),
      maxHealth: maxHealthFor(stats),
      cannonCooldown: 0,
      ramCooldown: 0,
      sailDisableTimer: 0,
      burnTicksRemaining: 0,
      burnTickTimer: 0,
      burnDamagePerTick: 0,
      burnOwnerId: null,
      alive: true,
      deathTimer: 0,
      socket,
      input: { turn: 0, throttle: 0, fire: false, boost: false },
      economy,
      hold: 0,
      spawnProtection: SPAWN_PROTECTION_TIME,
      boostCharge: economy.powder,
      boostTimer: 0,
      boostRechargeTimer: 0,
      disconnectedAt: null,
      heat: 0,
      hunterCheckTimer: 0,
    };
    this.ships.set(id, ship);
    return ship;
  }

  /** A ship whose socket dropped less than RECONNECT_GRACE_MS ago, if any —
   * used to reclaim it instead of spawning a fresh one at port. */
  findReclaimableShip(name: string): PlayerShip | undefined {
    for (const ship of this.ships.values()) {
      if (!ship.isBot && ship.name === name && ship.disconnectedAt !== null) return ship;
    }
    return undefined;
  }

  reconnectPlayer(ship: PlayerShip, socket: WebSocket) {
    ship.socket = socket;
    ship.disconnectedAt = null;
    ship.input = { turn: 0, throttle: 0, fire: false, boost: false };
  }

  /** Freezes the ship in place rather than deleting it immediately — see
   * findReclaimableShip / reconnectPlayer, and the sweep in tick(). */
  disconnectPlayer(id: string) {
    const ship = this.ships.get(id);
    if (!ship || ship.isBot) return;
    ship.input = { turn: 0, throttle: 0, fire: false, boost: false };
    ship.disconnectedAt = Date.now();
    this.persist(ship);
  }

  chat(ship: PlayerShip, text: string) {
    const trimmed = text.trim().slice(0, CHAT_MAX_LENGTH);
    if (!trimmed) return;
    this.events.push({ type: 'chat', name: ship.name, text: trimmed });
  }

  private persist(ship: PlayerShip) {
    savePlayer(ship.name, ship.economy);
  }

  private spawnBotWave() {
    const botCount = [...this.ships.values()].filter((s) => s.isBot).length;
    if (botCount >= this.maxEnemies()) return;
    const angle = Math.random() * Math.PI * 2;
    const dist = BOT_TIER_MIN_DIST + Math.random() * this.botSpawnRange();
    const tier = tierForDistance(dist, this.botTierStep());
    const stats: ShipStats = { sailLevel: tier, cannonLevel: tier, hullLevel: tier };
    const id = randomUUID();
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    const bot: BotShip = {
      id,
      name: `Enemy Tier ${tier + 1}`,
      isBot: true,
      isBoss: false,
      isRival: false,
      enraged: false,
      body: { x, z, heading: Math.random() * Math.PI * 2, speed: 0 },
      stats,
      loadout: { front: 0, left: 1, right: 1 },
      health: maxHealthFor(stats),
      maxHealth: maxHealthFor(stats),
      cannonCooldown: 0,
      ramCooldown: 0,
      sailDisableTimer: 0,
      burnTicksRemaining: 0,
      burnTickTimer: 0,
      burnDamagePerTick: 0,
      burnOwnerId: null,
      alive: true,
      deathTimer: 0,
      ai: {
        state: 'patrol',
        patrolX: x + (Math.random() - 0.5) * 100,
        patrolZ: z + (Math.random() - 0.5) * 100,
      },
      goldReward: 25 + tier * 20,
    };
    this.ships.set(id, bot);
  }

  /** The payoff of a completed treasure-hunt chain (see updateTreasureHunts):
   * a rare, tougher bot that escalates in difficulty and reward each time a
   * player reaches another BOSS_INTERVAL milestone. */
  private spawnBossShip(nearX: number, nearZ: number, targetPlayerId: string, bossNumber: number) {
    const tier = 4 + bossNumber;
    const stats: ShipStats = { sailLevel: tier, cannonLevel: tier, hullLevel: tier + 2 };
    const id = randomUUID();
    const angle = Math.random() * Math.PI * 2;
    const x = nearX + Math.cos(angle) * 50;
    const z = nearZ + Math.sin(angle) * 50;
    const boss: BotShip = {
      id,
      name: BOSS_NAMES[(bossNumber - 1) % BOSS_NAMES.length],
      isBot: true,
      isBoss: true,
      isRival: false,
      enraged: false,
      body: { x, z, heading: Math.random() * Math.PI * 2, speed: 0 },
      stats,
      loadout: { front: 0, left: 2, right: 2 },
      health: maxHealthFor(stats) * 1.8,
      maxHealth: maxHealthFor(stats) * 1.8,
      cannonCooldown: 0,
      ramCooldown: 0,
      sailDisableTimer: 0,
      burnTicksRemaining: 0,
      burnTickTimer: 0,
      burnDamagePerTick: 0,
      burnOwnerId: null,
      alive: true,
      deathTimer: 0,
      ai: { state: 'patrol', patrolX: x, patrolZ: z },
      goldReward: 1000 + bossNumber * 500,
    };
    this.ships.set(id, boss);
    this.events.push({
      type: 'message',
      text: `${boss.name} has appeared nearby! Sink it for a legendary reward.`,
      duration: 4000,
      for: targetPlayerId,
    });
  }

  /** An occasional, named mini-boss that roams the world ambiently — see
   * RIVAL_* constants above and the periodic check in tick(). Distinct from
   * spawnBossShip: not tied to treasure hunts, no enrage phase, but a
   * meaningful step up from a same-tier regular bot in health/reload/reward. */
  private spawnRivalCaptain() {
    const activeNames = new Set(
      [...this.ships.values()].filter((s): s is BotShip => s.isBot && s.isRival).map((s) => s.name),
    );
    const available = RIVAL_NAMES.filter((n) => !activeNames.has(n));
    if (available.length === 0) return;
    const name = available[Math.floor(Math.random() * available.length)];

    const angle = Math.random() * Math.PI * 2;
    const dist = BOT_TIER_MIN_DIST + Math.random() * this.botSpawnRange();
    const tier = tierForDistance(dist, this.botTierStep());
    const stats: ShipStats = { sailLevel: tier + RIVAL_SAIL_BONUS, cannonLevel: tier, hullLevel: tier };
    const id = randomUUID();
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    const baseHealth = maxHealthFor(stats);
    const rival: BotShip = {
      id,
      name,
      isBot: true,
      isBoss: false,
      isRival: true,
      enraged: false,
      body: { x, z, heading: Math.random() * Math.PI * 2, speed: 0 },
      stats,
      loadout: { front: 0, left: 2, right: 2 },
      health: baseHealth * RIVAL_HEALTH_MULT,
      maxHealth: baseHealth * RIVAL_HEALTH_MULT,
      cannonCooldown: 0,
      ramCooldown: 0,
      sailDisableTimer: 0,
      burnTicksRemaining: 0,
      burnTickTimer: 0,
      burnDamagePerTick: 0,
      burnOwnerId: null,
      alive: true,
      deathTimer: 0,
      ai: { state: 'patrol', patrolX: x, patrolZ: z },
      goldReward: Math.round((25 + tier * 20) * RIVAL_GOLD_MULT),
    };
    this.ships.set(id, rival);
    this.events.push({
      type: 'message',
      text: `Rival captain ${name} has been sighted on the horizon!`,
      duration: 4000,
    });
  }

  buyUpgrade(ship: PlayerShip, key: UpgradeKey): boolean {
    const level = ship.economy[key];
    if (level >= MAX_LEVEL) return false;
    const cost = Math.round(BASE_COST[key] * Math.pow(COST_GROWTH, level));
    if (ship.economy.gold < cost) return false;

    ship.economy.gold -= cost;
    ship.economy[key] += 1;
    ship.stats = statsForEconomy(ship.economy);
    ship.maxHealth = maxHealthFor(ship.stats);
    ship.health = key === 'hull' ? ship.maxHealth : Math.min(ship.health, ship.maxHealth);
    if (key === 'powder') ship.boostCharge = ship.economy.powder;
    this.persist(ship);
    return true;
  }

  buyShipClass(ship: PlayerShip): boolean {
    const nextClass = SHIP_CLASS_ORDER[SHIP_CLASS_ORDER.indexOf(ship.economy.shipClass) + 1];
    if (!nextClass) return false;
    const cost = SHIP_CLASS_CONFIG[nextClass].cost;
    if (ship.economy.gold < cost) return false;

    ship.economy.gold -= cost;
    ship.economy.shipClass = nextClass;
    ship.stats = statsForEconomy(ship.economy);
    ship.maxHealth = maxHealthFor(ship.stats);
    ship.health = ship.maxHealth;
    this.persist(ship);
    return true;
  }

  setLoadoutSlot(ship: PlayerShip, side: CannonSide, delta: 1 | -1): boolean {
    const totalSlots = SHIP_CLASS_CONFIG[ship.economy.shipClass].baseSlots + ship.economy.cannons;
    const assigned = ship.economy.loadout.front + ship.economy.loadout.left + ship.economy.loadout.right;
    const sideMax = side === 'front' ? FRONT_SLOT_MAX : SIDE_SLOT_MAX;
    if (delta > 0) {
      if (assigned >= totalSlots || ship.economy.loadout[side] >= sideMax) return false;
      ship.economy.loadout[side] += 1;
    } else {
      if (ship.economy.loadout[side] <= 0) return false;
      ship.economy.loadout[side] -= 1;
    }
    ship.loadout = { ...ship.economy.loadout };
    this.persist(ship);
    return true;
  }

  buildEconomySnapshot(ship: PlayerShip): EconomySnapshot {
    const keys: UpgradeKey[] = ['sails', 'cannons', 'hull', 'powder'];
    const costs = {} as Record<UpgradeKey, number>;
    const maxed = {} as Record<UpgradeKey, boolean>;
    for (const key of keys) {
      maxed[key] = ship.economy[key] >= MAX_LEVEL;
      costs[key] = Math.round(BASE_COST[key] * Math.pow(COST_GROWTH, ship.economy[key]));
    }
    const nextClass = SHIP_CLASS_ORDER[SHIP_CLASS_ORDER.indexOf(ship.economy.shipClass) + 1] ?? null;
    return {
      gold: ship.economy.gold,
      hold: ship.hold,
      holdAtRisk: Math.floor(ship.hold * SALVAGE_DROP_FRACTION),
      inSanctuary: this.isInSanctuary(ship.body.x, ship.body.z),
      spawnProtection: ship.spawnProtection,
      sails: ship.economy.sails,
      cannons: ship.economy.cannons,
      hull: ship.economy.hull,
      powder: ship.economy.powder,
      loadout: { ...ship.economy.loadout },
      costs,
      maxed,
      totalCannonSlots: SHIP_CLASS_CONFIG[ship.economy.shipClass].baseSlots + ship.economy.cannons,
      assignedCannonSlots: ship.economy.loadout.front + ship.economy.loadout.left + ship.economy.loadout.right,
      shipClass: ship.economy.shipClass,
      nextClass,
      nextClassCost: nextClass ? SHIP_CLASS_CONFIG[nextClass].cost : null,
      treasureHuntsCompleted: ship.economy.treasureHuntsCompleted,
      treasureHunt: ship.economy.treasureHunt,
      heat: ship.heat,
    };
  }

  private fireShip(ship: AnyShip, ammoType: AmmoType = 'round') {
    const scale = ship.isBot ? 0.9 : SHIP_CLASS_SCALE[ship.economy.shipClass];
    const balls = spawnCannonballs(
      ship.id,
      ship.isBot,
      ship.body.x,
      ship.body.z,
      ship.body.heading,
      scale,
      ship.loadout,
      cannonDamage(ship.stats),
      ammoType,
    );
    if (balls.length === 0) return;
    this.cannonballs.push(...balls);
    (['front', 'left', 'right'] as CannonSide[]).forEach((side) => {
      if (ship.loadout[side] > 0) this.events.push({ type: 'fire', shipId: ship.id, side });
    });
  }

  private updatePlayer(ship: PlayerShip, dt: number) {
    const input = ship.input;
    if (ship.boostTimer > 0) {
      ship.boostTimer -= dt;
    } else if (input.boost && ship.boostCharge >= 1) {
      ship.boostCharge -= 1;
      ship.boostTimer = BOOST_DURATION;
    }
    const boosting = ship.boostTimer > 0;
    if (!boosting && ship.boostCharge < ship.economy.powder) {
      ship.boostRechargeTimer += dt;
      if (ship.boostRechargeTimer >= BOOST_RECHARGE_TIME) {
        ship.boostRechargeTimer = 0;
        ship.boostCharge = Math.min(ship.economy.powder, ship.boostCharge + 1);
      }
    }

    applyControls(ship.body, ship.stats, input.turn, input.throttle, dt, boosting);
    if (ship.sailDisableTimer > 0) {
      const cap = topSpeed(ship.stats) * CHAIN_SPEED_MULT;
      ship.body.speed = Math.max(-cap, Math.min(cap, ship.body.speed));
    }
    const prevX = ship.body.x;
    const prevZ = ship.body.z;
    integrate(ship.body, dt);
    resolveIslandCollisions(this.islands, ship.body, prevX, prevZ);

    ship.cannonCooldown = Math.max(0, ship.cannonCooldown - dt);
    if (input.fire && ship.cannonCooldown <= 0) {
      const ammoType = input.ammoType ?? 'round';
      this.fireShip(ship, ammoType);
      ship.cannonCooldown = cannonReload(ship.stats) * (ammoType === 'chain' ? CHAIN_RELOAD_MULT : 1);
      // Firing forfeits respawn immunity — it's there to survive the first
      // few seconds after a sinking, not to be a shield you shoot from.
      ship.spawnProtection = 0;
    }
  }

  /** All at-sea income routes through here so nothing can accidentally pay
   * straight into the banked pile — that separation is the whole point of
   * the hold. `heats` is false for passive pickups (crates, treasure) and
   * true for anything earned by violence. */
  private addToHold(ship: PlayerShip, amount: number, heats: boolean) {
    if (amount <= 0) return;
    ship.hold += amount;
    if (heats) ship.heat = Math.min(HEAT_MAX, ship.heat + amount * HEAT_PER_GOLD_EARNED);
    this.events.push({ type: 'gold', amount, for: ship.id });
  }

  /** Entering the port sanctuary banks the hold instantly — no docking
   * animation, no standing still. On a touch screen, "sail into the ring"
   * is a gesture a thumb can execute; "hold position for 3 seconds" is not. */
  private updateBanking() {
    for (const ship of this.ships.values()) {
      if (ship.isBot || !ship.alive || ship.hold <= 0) continue;
      if (!this.isInSanctuary(ship.body.x, ship.body.z)) continue;
      const amount = Math.floor(ship.hold);
      ship.hold = 0;
      if (amount <= 0) continue;
      ship.economy.gold += amount;
      this.persist(ship);
      this.events.push({ type: 'banked', amount, for: ship.id });
      this.events.push({ type: 'message', text: `Banked ${amount} gold — safe ashore.`, duration: 2200, for: ship.id });
    }
  }

  /** Spills SALVAGE_DROP_FRACTION of the hold into floating chunks and
   * destroys the rest. Returns the amount that actually hit the water.
   * Chunk values are integers that sum to EXACTLY the dropped amount — a
   * naive even split would quietly lose gold to rounding on every death. */
  private dropSalvage(ship: PlayerShip): number {
    const dropped = Math.floor(ship.hold * SALVAGE_DROP_FRACTION);
    ship.hold = 0;
    if (dropped <= 0) return 0;

    const chunks = Math.max(1, Math.min(SALVAGE_MAX_CHUNKS, Math.ceil(dropped / SALVAGE_GOLD_PER_CHUNK)));
    const base = Math.floor(dropped / chunks);
    const remainder = dropped - base * chunks;
    for (let i = 0; i < chunks; i++) {
      const angle = (i / chunks) * Math.PI * 2 + (Math.random() - 0.5) * SALVAGE_SCATTER_JITTER;
      const r = SALVAGE_SCATTER_RADIUS * (1 + Math.random() * SALVAGE_SCATTER_SPREAD);
      this.salvage.push({
        id: randomUUID(),
        x: ship.body.x + Math.cos(angle) * r,
        z: ship.body.z + Math.sin(angle) * r,
        value: base + (i < remainder ? 1 : 0),
        ownerName: ship.name,
        ttl: SALVAGE_LIFETIME,
      });
    }
    return dropped;
  }

  private updateSalvage(dt: number) {
    if (this.salvage.length === 0) return;
    for (const pile of this.salvage) {
      pile.ttl -= dt;
      if (pile.ttl > 0) continue;
      pile.value = 0;
    }
    for (const ship of this.ships.values()) {
      if (ship.isBot || !ship.alive) continue;
      for (const pile of this.salvage) {
        if (pile.value <= 0) continue;
        if (Math.hypot(pile.x - ship.body.x, pile.z - ship.body.z) >= SALVAGE_PICKUP_RADIUS) continue;
        // Recovered gold lands UNBANKED, and heats you like any other spoils:
        // looting a kill makes you the next fat target, it doesn't cash out.
        this.addToHold(ship, pile.value, true);
        this.events.push({
          type: 'message',
          text: `Recovered ${pile.value} gold from ${pile.ownerName}'s wreck`,
          duration: 1600,
          for: ship.id,
        });
        pile.value = 0;
      }
    }
    this.salvage = this.salvage.filter((p) => p.value > 0 && p.ttl > 0);
  }

  private updateBot(bot: BotShip, players: PlayerShip[], dt: number) {
    // Heat-weighted nearest, not raw nearest: bots ignore anyone protected
    // (in port / freshly respawned / disconnected), and a wanted captain
    // outweighs proximity by up to 2x at HEAT_MAX. Without this, a player
    // could park next to a bot and use it as free cover from other players,
    // and bots would stay irrelevant to whoever's actually causing trouble.
    let nearest: PlayerShip | null = null;
    let bestScore = Infinity;
    for (const p of players) {
      if (this.isProtected(p)) continue;
      const d = Math.hypot(p.body.x - bot.body.x, p.body.z - bot.body.z);
      const score = d / (1 + (p.heat / HEAT_MAX) * BOT_HEAT_ATTRACTION);
      if (score < bestScore) {
        bestScore = score;
        nearest = p;
      }
    }
    const targetX = nearest ? nearest.body.x : bot.ai.patrolX;
    const targetZ = nearest ? nearest.body.z : bot.ai.patrolZ;

    if (bot.isBoss && !bot.enraged && bot.health <= bot.maxHealth * BOSS_ENRAGE_HEALTH_FRACTION) {
      bot.enraged = true;
      this.events.push({ type: 'message', text: `${bot.name} flies into a berserker rage!`, duration: 3500 });
    }

    const fireWindowDeg = bot.isBoss
      ? bot.enraged
        ? BOSS_ENRAGED_FIRE_WINDOW_DEG
        : BOSS_FIRE_WINDOW_DEG
      : bot.isRival
        ? RIVAL_FIRE_WINDOW_DEG
        : undefined;
    const { turn, throttle, wantsFire } = updateBotAI(bot.ai, bot.body, targetX, targetZ, nearest !== null, fireWindowDeg);

    applyControls(bot.body, bot.stats, turn, throttle, dt, false);
    if (bot.sailDisableTimer > 0) {
      const cap = topSpeed(bot.stats) * CHAIN_SPEED_MULT;
      bot.body.speed = Math.max(-cap, Math.min(cap, bot.body.speed));
    }
    const prevX = bot.body.x;
    const prevZ = bot.body.z;
    integrate(bot.body, dt);
    resolveIslandCollisions(this.islands, bot.body, prevX, prevZ);

    bot.cannonCooldown -= dt;
    if (bot.ai.state === 'attack' && bot.cannonCooldown <= 0 && wantsFire) {
      this.fireShip(bot);
      const reloadMultiplier = bot.isBoss
        ? bot.enraged
          ? BOSS_ENRAGED_RELOAD_MULT
          : BOSS_RELOAD_MULT
        : bot.isRival
          ? RIVAL_RELOAD_MULT
          : 1.5;
      bot.cannonCooldown = cannonReload(bot.stats) * reloadMultiplier;
    }
  }

  private respawnPlayer(ship: PlayerShip) {
    const spawn = homeSpawnPoint();
    ship.body.x = spawn.x;
    ship.body.z = spawn.z;
    ship.body.heading = Math.PI;
    ship.body.speed = 0;
    ship.health = ship.maxHealth;
    ship.alive = true;
    ship.deathTimer = 0;
    ship.sailDisableTimer = 0;
    ship.burnTicksRemaining = 0;
    ship.spawnProtection = SPAWN_PROTECTION_TIME;
    this.events.push({ type: 'message', text: 'Rescued! Back at port — banked gold is untouched.', duration: 2500, for: ship.id });
  }

  private updateCannonballs(dt: number) {
    for (const ball of this.cannonballs) {
      updateCannonball(ball, dt);
      if (!ball.alive && ball.hitWater) {
        this.events.push({ type: 'splash', x: ball.x, y: 0, z: ball.z });
      }
    }
  }

  /** Marks `ship` as sunk and settles the payout — shared between cannonball
   * kills (resolveCombat), ram kills (resolveRamming) and burn-tick kills
   * (updateStatusEffects) so every path credits identically.
   *
   * Bot kills pay gold into the killer's HOLD (unbanked). Player kills pay
   * the killer NOTHING directly: the reward is the victim's spilled hold,
   * which has to be physically collected. That's not squeamishness, it's the
   * anti-griefing property that falls out of the economy instead of needing
   * a rule — hunting a loaded captain is lucrative, and hunting a broke one
   * (a beginner, or someone who just banked) pays literally zero while still
   * costing HEAT_PER_PLAYER_KILL heat. Spawn-camping the poor is a net loss. */
  private killShip(ship: AnyShip, killer: AnyShip | undefined) {
    ship.alive = false;
    ship.deathTimer = 0;
    this.events.push({ type: 'sunk', shipId: ship.id, x: ship.body.x, z: ship.body.z });

    if (ship.isBot) {
      if (killer && !killer.isBot) {
        this.addToHold(killer, ship.goldReward, true);
        this.events.push({
          type: 'message',
          text: ship.isBoss
            ? `${ship.name} defeated! +${ship.goldReward} gold — a legendary victory!`
            : ship.isRival
              ? `You defeated rival captain ${ship.name}! +${ship.goldReward} gold`
              : `Enemy sunk! +${ship.goldReward} gold`,
          duration: ship.isBoss || ship.isRival ? 4000 : undefined,
          for: killer.id,
        });
        if (ship.isRival) {
          this.events.push({
            type: 'message',
            text: `Captain ${killer.name} has defeated the rival captain ${ship.name}!`,
            duration: 3500,
          });
        }
        if (!ship.isBoss && !ship.isRival && !killer.economy.treasureHunt && Math.random() < TREASURE_MAP_DROP_CHANCE) {
          killer.economy.treasureHunt = this.pickTreasureSite();
          this.events.push({
            type: 'message',
            text: 'Found a torn treasure map! Sail toward the golden light.',
            duration: 3000,
            for: killer.id,
          });
        }
        this.persist(killer);
      }
    } else {
      const dropped = this.dropSalvage(ship);
      this.events.push({
        type: 'message',
        text:
          dropped > 0
            ? `Sunk! ${dropped} gold spilled into the sea — your banked gold is safe.`
            : 'Sunk! Your hold was empty, so nothing was lost.',
        duration: 3200,
        for: ship.id,
      });

      if (killer && !killer.isBot && killer.id !== ship.id) {
        killer.heat = Math.min(HEAT_MAX, killer.heat + HEAT_PER_PLAYER_KILL);
        this.events.push({
          type: 'message',
          text:
            dropped > 0
              ? `You sank ${ship.name}! ${dropped} gold is in the water — go get it.`
              : `You sank ${ship.name}, but their hold was empty.`,
          duration: 3200,
          for: killer.id,
        });
        this.events.push({ type: 'message', text: `${killer.name} sank ${ship.name}!`, duration: 3000 });
      }
    }
  }

  /** Applies each ammo type's trade-off in one place: less base damage than
   * round shot, in exchange for the situational effect below. */
  private ammoDamage(ball: CannonballState): number {
    switch (ball.ammoType) {
      case 'chain':
        return ball.damage * CHAIN_DAMAGE_MULT;
      case 'grape':
        return ball.damage * (ball.age < GRAPE_CLOSE_AGE ? GRAPE_CLOSE_DAMAGE_MULT : GRAPE_FAR_DAMAGE_MULT);
      case 'fire':
        return ball.damage * FIRE_INITIAL_DAMAGE_MULT;
      default:
        return ball.damage;
    }
  }

  private applyAmmoEffect(ball: CannonballState, ship: AnyShip) {
    if (ball.ammoType === 'chain') {
      ship.sailDisableTimer = CHAIN_DISABLE_DURATION;
    } else if (ball.ammoType === 'fire') {
      ship.burnTicksRemaining = FIRE_DURATION / FIRE_TICK_INTERVAL;
      ship.burnTickTimer = FIRE_TICK_INTERVAL;
      ship.burnDamagePerTick = (ball.damage * FIRE_DOT_TOTAL_MULT) / (FIRE_DURATION / FIRE_TICK_INTERVAL);
      ship.burnOwnerId = ball.ownerId;
    }
  }

  /** Hull radius used for both cannon hits and ram contact. */
  private hullScale(ship: AnyShip): number {
    return ship.isBot ? 0.9 : SHIP_CLASS_SCALE[ship.economy.shipClass];
  }

  /** Inside this ring around home port, no damage flows in EITHER direction
   * and the hold banks automatically. Also the fast heat-decay ring — same
   * radius on purpose, so "safe", "banked" and "cooling off" are one place a
   * player can learn once instead of three overlapping invisible circles. */
  private isInSanctuary(x: number, z: number): boolean {
    const home = this.islands.find((isl) => isl.isHomePort);
    if (!home) return false;
    return Math.hypot(x - home.x, z - home.z) < home.radius + PORT_SANCTUARY_EXTRA;
  }

  /** Public read-only view of isProtected for the snapshot builder. */
  isShipProtected(ship: AnyShip): boolean {
    return this.isProtected(ship);
  }

  /** Can neither deal nor take damage. Bots are never protected. */
  private isProtected(ship: AnyShip): boolean {
    if (ship.isBot) return false;
    // Frozen ghost ships (socket dropped, inside the reconnect grace window)
    // would otherwise be free kills — trivially farmable, and it would punish
    // exactly the mobile players most likely to drop a connection.
    if (ship.disconnectedAt !== null) return true;
    if (ship.spawnProtection > 0) return true;
    return this.isInSanctuary(ship.body.x, ship.body.z);
  }

  /** PvP is fully open: player cannonballs now damage other players anywhere
   * outside the port sanctuary. What's still filtered out is bot-on-bot fire
   * (bots would otherwise wipe each other out in crossfire and the world
   * would empty itself) and anything involving a protected ship. */
  private canDamage(attacker: AnyShip | undefined, target: AnyShip): boolean {
    if (!target.alive) return false;
    if (!attacker) return !this.isProtected(target);
    if (attacker.id === target.id) return false;
    if (attacker.isBot && target.isBot) return false;
    return !this.isProtected(attacker) && !this.isProtected(target);
  }

  private resolveCombat() {
    for (const ball of this.cannonballs) {
      if (!ball.alive) continue;
      const owner = this.ships.get(ball.ownerId);
      // A shot fired before the shooter reached safety still can't land once
      // they're inside it — resolved at impact, not at launch, so ducking
      // into the sanctuary genuinely disengages you from a fight.
      if (owner && this.isProtected(owner)) continue;
      for (const ship of this.ships.values()) {
        if (ship.id === ball.ownerId) continue;
        if (ship.isBot && ball.ownerIsBot) continue;
        if (!this.canDamage(owner, ship)) continue;
        const hitRadius = HIT_RADIUS * this.hullScale(ship);
        if (Math.hypot(ship.body.x - ball.x, ship.body.z - ball.z) >= hitRadius) continue;

        const damage = this.ammoDamage(ball);
        ship.health = Math.max(0, ship.health - damage);
        this.applyAmmoEffect(ball, ship);
        ball.alive = false;
        this.events.push({
          type: 'hit',
          x: ball.x,
          y: ball.y,
          z: ball.z,
          targetId: ship.id,
          ownerId: ball.ownerId,
          damage,
        });

        if (ship.health <= 0) this.killShip(ship, this.ships.get(ball.ownerId));
        break;
      }
    }
    this.cannonballs = this.cannonballs.filter((b) => b.alive);
  }

  /** Driving your hull into another ship at speed damages both sides — see
   * the RAM_* constants above. Now runs over every ordered pair where at
   * least one side is a player, so player-vs-player ramming works exactly
   * like player-vs-bot did. Bot-vs-bot is still excluded (bots would grind
   * each other down on patrol and empty the world). Ramming stays a genuine
   * trade-off in PvP for the same reason it is against bots: it costs you
   * the same damage you deal, so it's the move for finishing a ship that's
   * already hurt worse than you, not a strictly better broadside. */
  private resolveRamming() {
    const candidates = [...this.ships.values()].filter((s) => s.alive && !this.isProtected(s));

    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i];
        const b = candidates[j];
        if (a.isBot && b.isBot) continue;
        if (!a.alive || !b.alive || a.ramCooldown > 0 || b.ramCooldown > 0) continue;

        const dx = b.body.x - a.body.x;
        const dz = b.body.z - a.body.z;
        const dist = Math.hypot(dx, dz);
        const minDist = RAM_CONTACT_RADIUS * (this.hullScale(a) + this.hullScale(b));
        if (dist >= minDist) continue;

        const aVX = Math.sin(a.body.heading) * a.body.speed;
        const aVZ = Math.cos(a.body.heading) * a.body.speed;
        const bVX = Math.sin(b.body.heading) * b.body.speed;
        const bVZ = Math.cos(b.body.heading) * b.body.speed;
        const relSpeed = Math.hypot(aVX - bVX, aVZ - bVZ);
        if (relSpeed < RAM_MIN_SPEED) continue;

        const damage = Math.min(RAM_MAX_DAMAGE, relSpeed * RAM_DAMAGE_PER_SPEED);
        a.health = Math.max(0, a.health - damage);
        b.health = Math.max(0, b.health - damage);
        a.ramCooldown = RAM_COOLDOWN;
        b.ramCooldown = RAM_COOLDOWN;

        const nx = dist < 0.001 ? 1 : dx / dist;
        const nz = dist < 0.001 ? 0 : dz / dist;
        const overlap = minDist - dist;
        a.body.x -= nx * overlap * 0.5;
        a.body.z -= nz * overlap * 0.5;
        b.body.x += nx * overlap * 0.5;
        b.body.z += nz * overlap * 0.5;
        a.body.speed *= RAM_KNOCKBACK_SPEED_MULT;
        b.body.speed *= RAM_KNOCKBACK_SPEED_MULT;

        const midX = (a.body.x + b.body.x) / 2;
        const midZ = (a.body.z + b.body.z) / 2;
        this.events.push({ type: 'ram', x: midX, y: 1, z: midZ });
        this.events.push({ type: 'hit', x: b.body.x, y: 1, z: b.body.z, targetId: b.id, ownerId: a.id, damage });
        this.events.push({ type: 'hit', x: a.body.x, y: 1, z: a.body.z, targetId: a.id, ownerId: b.id, damage });

        if (b.health <= 0) this.killShip(b, a);
        if (a.health <= 0) this.killShip(a, b);
      }
    }
  }

  private updateCrates() {
    for (const ship of this.ships.values()) {
      if (ship.isBot || !ship.alive) continue;
      for (const crate of this.crates) {
        if (crate.collected || Math.hypot(crate.x - ship.body.x, crate.z - ship.body.z) >= CRATE_RADIUS) continue;
        crate.collected = true;
        // Crates are passive pickups: they fill the hold but don't raise heat.
        this.addToHold(ship, crate.value, false);
        this.events.push({ type: 'message', text: `+${crate.value} gold to hold`, duration: 1200, for: ship.id });
        setTimeout(() => {
          const idx = this.crates.indexOf(crate);
          if (idx >= 0) this.crates[idx] = spawnCrate(this.islands, this.worldRadius);
        }, CRATE_RESPAWN_DELAY);
      }
    }
  }

  private pickTreasureSite(): { x: number; z: number } {
    const candidates = this.islands.filter((isl) => !isl.isHomePort);
    const island = candidates[Math.floor(Math.random() * candidates.length)];
    const angle = Math.random() * Math.PI * 2;
    const dist = island.radius * 0.6;
    return { x: island.x + Math.cos(angle) * dist, z: island.z + Math.sin(angle) * dist };
  }

  private updateTreasureHunts() {
    for (const ship of this.ships.values()) {
      if (ship.isBot || !ship.alive || !ship.economy.treasureHunt) continue;
      const site = ship.economy.treasureHunt;
      if (Math.hypot(site.x - ship.body.x, site.z - ship.body.z) >= TREASURE_DIG_RADIUS) continue;

      const reward = Math.min(
        TREASURE_REWARD_CAP,
        TREASURE_BASE_REWARD + ship.economy.treasureHuntsCompleted * TREASURE_REWARD_PER_HUNT,
      );
      // Into the hold, not the bank — a dug-up chest is the single fattest
      // thing you can be carrying, which is exactly when the run home should
      // be tense. The hunt progress itself is persisted immediately, so a
      // sinking costs you the gold but never the chain.
      this.addToHold(ship, reward, false);
      ship.economy.treasureHuntsCompleted += 1;
      ship.economy.treasureHunt = null;
      this.events.push({ type: 'message', text: `Treasure found! +${reward} gold to hold`, duration: 2500, for: ship.id });
      this.persist(ship);

      if (ship.economy.treasureHuntsCompleted % BOSS_INTERVAL === 0) {
        this.spawnBossShip(ship.body.x, ship.body.z, ship.id, ship.economy.treasureHuntsCompleted / BOSS_INTERVAL);
      }
    }
  }

  /** A tougher bot sent after a specific player once their heat runs high —
   * the "the longer you stay out, the worse it gets" push-your-luck timer. */
  private spawnHunterShip(target: PlayerShip) {
    const tier = Math.min(4, Math.max(1, Math.floor(target.heat / 25)));
    const stats: ShipStats = { sailLevel: tier, cannonLevel: tier, hullLevel: tier };
    const id = randomUUID();
    const angle = Math.random() * Math.PI * 2;
    const dist = 70 + Math.random() * 30;
    const x = target.body.x + Math.cos(angle) * dist;
    const z = target.body.z + Math.sin(angle) * dist;
    const hunter: BotShip = {
      id,
      name: `Hunter Tier ${tier + 1}`,
      isBot: true,
      isBoss: false,
      isRival: false,
      enraged: false,
      body: { x, z, heading: Math.random() * Math.PI * 2, speed: 0 },
      stats,
      loadout: { front: 0, left: 1, right: 1 },
      health: maxHealthFor(stats),
      maxHealth: maxHealthFor(stats),
      cannonCooldown: 0,
      ramCooldown: 0,
      sailDisableTimer: 0,
      burnTicksRemaining: 0,
      burnTickTimer: 0,
      burnDamagePerTick: 0,
      burnOwnerId: null,
      alive: true,
      deathTimer: 0,
      ai: { state: 'patrol', patrolX: x, patrolZ: z },
      goldReward: 30 + tier * 25,
    };
    this.ships.set(id, hunter);
    this.events.push({ type: 'message', text: 'A hunter ship has picked up your trail!', duration: 3000, for: target.id });
  }

  /** Heat rises on kills — a flat HEAT_PER_PLAYER_KILL for sinking another
   * captain, gold-scaled for bot kills and salvage recovery — and decays
   * over time, fast inside the port sanctuary so making port is the natural
   * way to cool off. While it's high it periodically summons a hunter ship
   * AND makes every bot in range prefer you as a target (see updateBot). */
  private updateHeat(dt: number) {
    for (const ship of this.ships.values()) {
      if (ship.isBot || !ship.alive) continue;
      const decay = this.isInSanctuary(ship.body.x, ship.body.z) ? HEAT_DECAY_PER_SEC_AT_PORT : HEAT_DECAY_PER_SEC;
      ship.heat = Math.max(0, ship.heat - decay * dt);

      ship.hunterCheckTimer += dt;
      if (ship.hunterCheckTimer < HUNTER_CHECK_INTERVAL) continue;
      ship.hunterCheckTimer = 0;
      if (ship.heat > 0 && Math.random() < (ship.heat / HEAT_MAX) * HUNTER_SPAWN_CHANCE_AT_MAX_HEAT) {
        this.spawnHunterShip(ship);
      }
    }
  }

  /** Counts down sail-disable (see updatePlayer/updateBot's speed cap) and
   * ticks burn damage — both set by applyAmmoEffect on a chain/fire hit. A
   * burn-tick kill credits the ship that lit the fire, same as a direct hit. */
  private updateStatusEffects(ship: AnyShip, dt: number) {
    if (ship.sailDisableTimer > 0) ship.sailDisableTimer = Math.max(0, ship.sailDisableTimer - dt);
    if (ship.burnTicksRemaining <= 0) return;

    ship.burnTickTimer -= dt;
    if (ship.burnTickTimer > 0) return;
    ship.burnTickTimer += FIRE_TICK_INTERVAL;
    ship.burnTicksRemaining -= 1;

    ship.health = Math.max(0, ship.health - ship.burnDamagePerTick);
    this.events.push({
      type: 'hit',
      x: ship.body.x,
      y: 1.2,
      z: ship.body.z,
      targetId: ship.id,
      ownerId: ship.burnOwnerId ?? ship.id,
      damage: ship.burnDamagePerTick,
    });
    if (ship.health <= 0) {
      this.killShip(ship, ship.burnOwnerId ? this.ships.get(ship.burnOwnerId) : undefined);
    }
  }

  /** Call after broadcasting a tick's events — not at the start of tick()
   * itself, since chat messages arrive asynchronously between ticks via the
   * WebSocket handler and would otherwise get wiped by the next tick before
   * broadcast() ever reads them. */
  clearEvents() {
    this.events = [];
  }

  tick(dt: number) {
    this.enemySpawnTimer += dt;
    if (this.enemySpawnTimer > ENEMY_SPAWN_INTERVAL) {
      this.enemySpawnTimer = 0;
      this.spawnBotWave();
    }

    this.rivalSpawnTimer += dt;
    if (this.rivalSpawnTimer > RIVAL_CHECK_INTERVAL) {
      this.rivalSpawnTimer = 0;
      const activeRivals = [...this.ships.values()].filter((s) => s.isBot && s.isRival).length;
      if (activeRivals < MAX_ACTIVE_RIVALS && Math.random() < RIVAL_SPAWN_CHANCE) {
        this.spawnRivalCaptain();
      }
    }

    const now = Date.now();
    for (const ship of this.ships.values()) {
      if (!ship.isBot && ship.disconnectedAt !== null && now - ship.disconnectedAt > RECONNECT_GRACE_MS) {
        // A ghost ship is immune while it waits out the grace window, so a
        // rage-quit can't be used to protect a fat hold — it just delays the
        // spill by 60 seconds. Reconnect inside the window and the hold is
        // still yours to sail home, which is what a real mobile connection
        // drop deserves.
        if (ship.alive) this.dropSalvage(ship);
        this.ships.delete(ship.id);
      }
    }

    const alivePlayers = [...this.ships.values()].filter((s): s is PlayerShip => !s.isBot && s.alive);

    for (const ship of [...this.ships.values()]) {
      if (ship.ramCooldown > 0) ship.ramCooldown = Math.max(0, ship.ramCooldown - dt);
      if (!ship.isBot && ship.spawnProtection > 0) ship.spawnProtection = Math.max(0, ship.spawnProtection - dt);
      if (ship.alive) this.updateStatusEffects(ship, dt);
      if (!ship.alive) {
        ship.deathTimer += dt;
        if (!ship.isBot && ship.deathTimer > PLAYER_RESPAWN_DELAY) this.respawnPlayer(ship);
        else if (ship.isBot && ship.deathTimer > BOT_DESPAWN_DELAY) this.ships.delete(ship.id);
        continue;
      }
      if (ship.isBot) this.updateBot(ship, alivePlayers, dt);
      else this.updatePlayer(ship, dt);
    }

    this.updateCannonballs(dt);
    this.resolveCombat();
    this.resolveRamming();
    this.updateCrates();
    this.updateSalvage(dt);
    this.updateTreasureHunts();
    this.updateHeat(dt);
    // Last, so anything earned this tick banks the same tick a player
    // crosses into the sanctuary rather than one tick later.
    this.updateBanking();
  }
}
