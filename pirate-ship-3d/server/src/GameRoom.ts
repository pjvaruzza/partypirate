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
  BASE_CANNON_SLOTS,
  FRONT_SLOT_MAX,
  MAX_LEVEL,
  SIDE_SLOT_MAX,
  type CannonLoadout,
  type CannonSide,
  type EconomySnapshot,
  type GameEvent,
  type IslandInfo,
  type InputState,
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

const BASE_COST: Record<UpgradeKey, number> = { sails: 40, cannons: 50, hull: 45, powder: 60 };
const COST_GROWTH = 1.55;

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
}

export interface BotShip extends BaseShip {
  isBot: true;
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
    const stats: ShipStats = { sailLevel: economy.sails, cannonLevel: economy.cannons, hullLevel: economy.hull };
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
    };
    this.ships.set(id, ship);
    return ship;
  }

  removePlayer(id: string) {
    const ship = this.ships.get(id);
    if (ship && !ship.isBot) savePlayer(ship.name, ship.economy);
    this.ships.delete(id);
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

  buyUpgrade(ship: PlayerShip, key: UpgradeKey): boolean {
    const level = ship.economy[key];
    if (level >= MAX_LEVEL) return false;
    const cost = Math.round(BASE_COST[key] * Math.pow(COST_GROWTH, level));
    if (ship.economy.gold < cost) return false;

    ship.economy.gold -= cost;
    ship.economy[key] += 1;
    ship.stats = { sailLevel: ship.economy.sails, cannonLevel: ship.economy.cannons, hullLevel: ship.economy.hull };
    ship.maxHealth = maxHealthFor(ship.stats);
    ship.health = key === 'hull' ? ship.maxHealth : Math.min(ship.health, ship.maxHealth);
    if (key === 'powder') ship.boostCharge = ship.economy.powder;
    this.persist(ship);
    return true;
  }

  setLoadoutSlot(ship: PlayerShip, side: CannonSide, delta: 1 | -1): boolean {
    const totalSlots = BASE_CANNON_SLOTS + ship.economy.cannons;
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
    return {
      gold: ship.economy.gold,
      sails: ship.economy.sails,
      cannons: ship.economy.cannons,
      hull: ship.economy.hull,
      powder: ship.economy.powder,
      loadout: { ...ship.economy.loadout },
      costs,
      maxed,
      totalCannonSlots: BASE_CANNON_SLOTS + ship.economy.cannons,
      assignedCannonSlots: ship.economy.loadout.front + ship.economy.loadout.left + ship.economy.loadout.right,
    };
  }

  private fireShip(ship: AnyShip) {
    const scale = ship.isBot ? 0.9 : 1;
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
    const { turn, throttle, wantsFire } = updateBotAI(bot.ai, bot.body, targetX, targetZ, nearest !== null);

    applyControls(bot.body, bot.stats, turn, throttle, dt, false);
    const prevX = bot.body.x;
    const prevZ = bot.body.z;
    integrate(bot.body, dt);
    resolveIslandCollisions(this.islands, bot.body, prevX, prevZ);

    bot.cannonCooldown -= dt;
    if (bot.ai.state === 'attack' && bot.cannonCooldown <= 0 && wantsFire) {
      this.fireShip(bot);
      bot.cannonCooldown = cannonReload(bot.stats) * 1.5;
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
        if (Math.hypot(ship.body.x - ball.x, ship.body.z - ball.z) >= HIT_RADIUS) continue;

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
              this.events.push({ type: 'gold', amount: ship.goldReward, for: killer.id });
              this.events.push({
                type: 'message',
                text: `Enemy sunk! +${ship.goldReward} gold`,
                for: killer.id,
              });
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

  tick(dt: number) {
    this.events = [];
    this.enemySpawnTimer += dt;
    if (this.enemySpawnTimer > ENEMY_SPAWN_INTERVAL) {
      this.enemySpawnTimer = 0;
      this.spawnBotWave();
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
  }
}
