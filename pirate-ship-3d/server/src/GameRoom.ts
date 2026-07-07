import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  applyControls,
  cannonDamage,
  cannonReload,
  integrate,
  maxHealthFor,
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
  type CannonLoadout,
  type CannonSide,
  type EconomySnapshot,
  type GameEvent,
  type IslandInfo,
  type InputState,
  type ShipClass,
  type UpgradeKey,
} from '../../src/shared/protocol';

const MAX_ENEMIES = 6;
const ENEMY_SPAWN_INTERVAL = 8;
const CRATE_RESPAWN_DELAY = 15000;
const PLAYER_RESPAWN_DELAY = 3;
const BOT_DESPAWN_DELAY = 2.5;
const BOOST_DURATION = 4;
const BOOST_RECHARGE_TIME = 12;
const HIT_RADIUS = 3;
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

const HEAT_MAX = 100;
const HEAT_PER_GOLD_EARNED = 0.15;
const HEAT_DECAY_PER_SEC = 1.2;
const HEAT_DECAY_PER_SEC_AT_PORT = 20;
const HOME_PORT_HEAT_RADIUS_EXTRA = 15;
const HUNTER_CHECK_INTERVAL = 12;
const HUNTER_SPAWN_CHANCE_AT_MAX_HEAT = 0.5;

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
}

export interface PlayerShip extends BaseShip {
  isBot: false;
  socket: WebSocket;
  input: InputState;
  economy: PersistedEconomy;
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
  /** One-way flip when a boss drops below BOSS_ENRAGE_HEALTH_FRACTION — see updateBot. */
  enraged: boolean;
  ai: BotAiState;
  goldReward: number;
}

export type AnyShip = PlayerShip | BotShip;

export class GameRoom {
  readonly worldRadius: number;
  readonly islands: IslandInfo[];
  crates: CrateState[] = [];
  cannonballs: CannonballState[] = [];
  ships = new Map<string, AnyShip>();
  events: GameEvent[] = [];

  private enemySpawnTimer = 0;

  constructor(worldRadius = 900, islandCount = 12) {
    this.worldRadius = worldRadius;
    this.islands = generateIslands(islandCount, worldRadius);
    for (let i = 0; i < 18; i++) this.crates.push(spawnCrate(this.islands, worldRadius));
    for (let i = 0; i < 4; i++) this.spawnBotWave();
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
      alive: true,
      deathTimer: 0,
      socket,
      input: { turn: 0, throttle: 0, fire: false, boost: false },
      economy,
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
    if (botCount >= MAX_ENEMIES) return;
    const angle = Math.random() * Math.PI * 2;
    const dist = 120 + Math.random() * (this.worldRadius - 150);
    const tier = Math.min(4, Math.floor(dist / 220));
    const stats: ShipStats = { sailLevel: tier, cannonLevel: tier, hullLevel: tier };
    const id = randomUUID();
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    const bot: BotShip = {
      id,
      name: `Enemy Tier ${tier + 1}`,
      isBot: true,
      isBoss: false,
      enraged: false,
      body: { x, z, heading: Math.random() * Math.PI * 2, speed: 0 },
      stats,
      loadout: { front: 0, left: 1, right: 1 },
      health: maxHealthFor(stats),
      maxHealth: maxHealthFor(stats),
      cannonCooldown: 0,
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
      enraged: false,
      body: { x, z, heading: Math.random() * Math.PI * 2, speed: 0 },
      stats,
      loadout: { front: 0, left: 2, right: 2 },
      health: maxHealthFor(stats) * 1.8,
      maxHealth: maxHealthFor(stats) * 1.8,
      cannonCooldown: 0,
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

  private fireShip(ship: AnyShip) {
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
    const prevX = ship.body.x;
    const prevZ = ship.body.z;
    integrate(ship.body, dt);
    resolveIslandCollisions(this.islands, ship.body, prevX, prevZ);

    ship.cannonCooldown = Math.max(0, ship.cannonCooldown - dt);
    if (input.fire && ship.cannonCooldown <= 0) {
      this.fireShip(ship);
      ship.cannonCooldown = cannonReload(ship.stats);
    }
  }

  private updateBot(bot: BotShip, players: PlayerShip[], dt: number) {
    let nearest: PlayerShip | null = null;
    let nearestDist = Infinity;
    for (const p of players) {
      const d = Math.hypot(p.body.x - bot.body.x, p.body.z - bot.body.z);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = p;
      }
    }
    const targetX = nearest ? nearest.body.x : bot.ai.patrolX;
    const targetZ = nearest ? nearest.body.z : bot.ai.patrolZ;

    if (bot.isBoss && !bot.enraged && bot.health <= bot.maxHealth * BOSS_ENRAGE_HEALTH_FRACTION) {
      bot.enraged = true;
      this.events.push({ type: 'message', text: `${bot.name} flies into a berserker rage!`, duration: 3500 });
    }

    const fireWindowDeg = bot.isBoss ? (bot.enraged ? BOSS_ENRAGED_FIRE_WINDOW_DEG : BOSS_FIRE_WINDOW_DEG) : undefined;
    const { turn, throttle, wantsFire } = updateBotAI(bot.ai, bot.body, targetX, targetZ, nearest !== null, fireWindowDeg);

    applyControls(bot.body, bot.stats, turn, throttle, dt, false);
    const prevX = bot.body.x;
    const prevZ = bot.body.z;
    integrate(bot.body, dt);
    resolveIslandCollisions(this.islands, bot.body, prevX, prevZ);

    bot.cannonCooldown -= dt;
    if (bot.ai.state === 'attack' && bot.cannonCooldown <= 0 && wantsFire) {
      this.fireShip(bot);
      const reloadMultiplier = bot.isBoss ? (bot.enraged ? BOSS_ENRAGED_RELOAD_MULT : BOSS_RELOAD_MULT) : 1.5;
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
    this.events.push({ type: 'message', text: 'Rescued! Back at port.', duration: 2500, for: ship.id });
  }

  private updateCannonballs(dt: number) {
    for (const ball of this.cannonballs) {
      updateCannonball(ball, dt);
      if (!ball.alive && ball.hitWater) {
        this.events.push({ type: 'splash', x: ball.x, y: 0, z: ball.z });
      }
    }
  }

  private resolveCombat() {
    for (const ball of this.cannonballs) {
      if (!ball.alive) continue;
      for (const ship of this.ships.values()) {
        if (!ship.alive || ship.id === ball.ownerId || ship.isBot === ball.ownerIsBot) continue;
        const hitRadius = HIT_RADIUS * (ship.isBot ? 0.9 : SHIP_CLASS_SCALE[ship.economy.shipClass]);
        if (Math.hypot(ship.body.x - ball.x, ship.body.z - ball.z) >= hitRadius) continue;

        ship.health = Math.max(0, ship.health - ball.damage);
        ball.alive = false;
        this.events.push({ type: 'hit', x: ball.x, y: ball.y, z: ball.z, targetId: ship.id });

        if (ship.health <= 0) {
          ship.alive = false;
          ship.deathTimer = 0;
          this.events.push({ type: 'sunk', shipId: ship.id, x: ship.body.x, z: ship.body.z });
          if (ship.isBot) {
            const killer = this.ships.get(ball.ownerId);
            if (killer && !killer.isBot) {
              killer.economy.gold += ship.goldReward;
              killer.heat = Math.min(HEAT_MAX, killer.heat + ship.goldReward * HEAT_PER_GOLD_EARNED);
              this.events.push({ type: 'gold', amount: ship.goldReward, for: killer.id });
              this.events.push({
                type: 'message',
                text: ship.isBoss
                  ? `${ship.name} defeated! +${ship.goldReward} gold — a legendary victory!`
                  : `Enemy sunk! +${ship.goldReward} gold`,
                duration: ship.isBoss ? 4000 : undefined,
                for: killer.id,
              });
              if (!ship.isBoss && !killer.economy.treasureHunt && Math.random() < TREASURE_MAP_DROP_CHANCE) {
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
            this.events.push({ type: 'message', text: 'Your ship has sunk!', duration: 3000, for: ship.id });
          }
        }
        break;
      }
    }
    this.cannonballs = this.cannonballs.filter((b) => b.alive);
  }

  private updateCrates() {
    for (const ship of this.ships.values()) {
      if (ship.isBot || !ship.alive) continue;
      for (const crate of this.crates) {
        if (crate.collected || Math.hypot(crate.x - ship.body.x, crate.z - ship.body.z) >= CRATE_RADIUS) continue;
        crate.collected = true;
        ship.economy.gold += crate.value;
        this.events.push({ type: 'gold', amount: crate.value, for: ship.id });
        this.events.push({ type: 'message', text: `+${crate.value} gold`, duration: 1200, for: ship.id });
        this.persist(ship);
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
      ship.economy.gold += reward;
      ship.economy.treasureHuntsCompleted += 1;
      ship.economy.treasureHunt = null;
      this.events.push({ type: 'gold', amount: reward, for: ship.id });
      this.events.push({ type: 'message', text: `Treasure found! +${reward} gold`, duration: 2500, for: ship.id });
      this.persist(ship);

      if (ship.economy.treasureHuntsCompleted % BOSS_INTERVAL === 0) {
        this.spawnBossShip(ship.body.x, ship.body.z, ship.id, ship.economy.treasureHuntsCompleted / BOSS_INTERVAL);
      }
    }
  }

  private isNearHomePort(x: number, z: number): boolean {
    const home = this.islands.find((isl) => isl.isHomePort);
    if (!home) return false;
    return Math.hypot(x - home.x, z - home.z) < home.radius + HOME_PORT_HEAT_RADIUS_EXTRA;
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
      enraged: false,
      body: { x, z, heading: Math.random() * Math.PI * 2, speed: 0 },
      stats,
      loadout: { front: 0, left: 1, right: 1 },
      health: maxHealthFor(stats),
      maxHealth: maxHealthFor(stats),
      cannonCooldown: 0,
      alive: true,
      deathTimer: 0,
      ai: { state: 'patrol', patrolX: x, patrolZ: z },
      goldReward: 30 + tier * 25,
    };
    this.ships.set(id, hunter);
    this.events.push({ type: 'message', text: 'A hunter ship has picked up your trail!', duration: 3000, for: target.id });
  }

  /** Heat rises on kills (see resolveCombat), decays over time — fast near
   * home port, so making port is the natural way to "cool off" — and
   * periodically has a chance to summon a hunter ship while it's high. */
  private updateHeat(dt: number) {
    for (const ship of this.ships.values()) {
      if (ship.isBot || !ship.alive) continue;
      const decay = this.isNearHomePort(ship.body.x, ship.body.z) ? HEAT_DECAY_PER_SEC_AT_PORT : HEAT_DECAY_PER_SEC;
      ship.heat = Math.max(0, ship.heat - decay * dt);

      ship.hunterCheckTimer += dt;
      if (ship.hunterCheckTimer < HUNTER_CHECK_INTERVAL) continue;
      ship.hunterCheckTimer = 0;
      if (ship.heat > 0 && Math.random() < (ship.heat / HEAT_MAX) * HUNTER_SPAWN_CHANCE_AT_MAX_HEAT) {
        this.spawnHunterShip(ship);
      }
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

    const now = Date.now();
    for (const ship of this.ships.values()) {
      if (!ship.isBot && ship.disconnectedAt !== null && now - ship.disconnectedAt > RECONNECT_GRACE_MS) {
        this.ships.delete(ship.id);
      }
    }

    const alivePlayers = [...this.ships.values()].filter((s): s is PlayerShip => !s.isBot && s.alive);

    for (const ship of [...this.ships.values()]) {
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
    this.updateCrates();
    this.updateTreasureHunts();
    this.updateHeat(dt);
  }
}
