import * as THREE from 'three';
import { Ship, cannonMountOffsets, type ShipStats, type CannonSide } from './Ship';
import { Effects } from './Effects';
import { SoundManager } from './Audio';

const GRAVITY = 9.8;

export class Cannonball {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  mesh: THREE.Mesh;
  damage: number;
  owner: 'player' | 'enemy';
  alive = true;
  /** Set when the ball expired by hitting the waterline (vs. hitting a ship). */
  hitWater = false;
  private age = 0;

  constructor(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    damage: number,
    owner: 'player' | 'enemy',
    scene: THREE.Scene,
  ) {
    this.position = position.clone();
    this.velocity = velocity.clone();
    this.damage = damage;
    this.owner = owner;
    const geo = new THREE.SphereGeometry(0.22, 12, 12);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.copy(this.position);
    scene.add(this.mesh);
  }

  update(dt: number, waterHeight: number) {
    this.velocity.y -= GRAVITY * dt;
    this.position.addScaledVector(this.velocity, dt);
    this.mesh.position.copy(this.position);
    this.age += dt;
    if (this.position.y <= waterHeight) {
      this.alive = false;
      this.hitWater = true;
    } else if (this.age > 6) {
      this.alive = false;
    }
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.mesh);
  }
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

const IDEAL_BROADSIDE_RANGE = 28;
const BROADSIDE_FIRE_WINDOW = (35 * Math.PI) / 180; // fire once within 35° of pure broadside-on

export class EnemyShip {
  ship: Ship;
  state: 'patrol' | 'chase' | 'attack' = 'patrol';
  patrolTarget: THREE.Vector3;
  goldReward: number;
  rewarded = false;

  constructor(stats: ShipStats, spawnPos: THREE.Vector3, goldReward: number) {
    this.ship = new Ship(stats, { hullColor: 0x4a3527, sailColor: 0x8b1e1e, scale: 0.9 });
    this.ship.position.copy(spawnPos);
    this.ship.heading = Math.random() * Math.PI * 2;
    this.patrolTarget = spawnPos.clone().add(
      new THREE.Vector3((Math.random() - 0.5) * 100, 0, (Math.random() - 0.5) * 100),
    );
    this.goldReward = goldReward;
  }

  update(dt: number, playerPos: THREE.Vector3, fireCallback: (ship: Ship) => void) {
    if (!this.ship.alive) return;
    const toPlayer = new THREE.Vector3().subVectors(playerPos, this.ship.position);
    const distToPlayer = toPlayer.length();
    const detectRange = 90;
    const attackRange = 45;

    if (distToPlayer < detectRange) {
      this.state = distToPlayer < attackRange ? 'attack' : 'chase';
    } else {
      this.state = 'patrol';
    }

    let desiredHeading: number;
    let throttle: number;

    if (this.state === 'attack') {
      // Pull broadside-on rather than pointing the bow at the target: aim for
      // whichever perpendicular heading is closer to the current one (so the
      // ship settles into an orbit instead of flip-flopping sides), and back
      // off or close in to hold a comfortable firing range.
      const bearingToTarget = Math.atan2(toPlayer.x, toPlayer.z);
      const perpA = bearingToTarget + Math.PI / 2;
      const perpB = bearingToTarget - Math.PI / 2;
      const dA = angleDiff(perpA, this.ship.heading);
      const dB = angleDiff(perpB, this.ship.heading);
      desiredHeading = Math.abs(dA) < Math.abs(dB) ? perpA : perpB;
      if (distToPlayer > IDEAL_BROADSIDE_RANGE + 10) throttle = 0.85;
      else if (distToPlayer < IDEAL_BROADSIDE_RANGE - 10) throttle = 0.3;
      else throttle = 0.55;
    } else if (this.state === 'chase') {
      desiredHeading = Math.atan2(toPlayer.x, toPlayer.z);
      throttle = 0.9;
    } else {
      if (this.ship.position.distanceTo(this.patrolTarget) < 10) {
        this.patrolTarget = this.ship.position.clone().add(
          new THREE.Vector3((Math.random() - 0.5) * 150, 0, (Math.random() - 0.5) * 150),
        );
      }
      const toPatrol = new THREE.Vector3().subVectors(this.patrolTarget, this.ship.position);
      desiredHeading = Math.atan2(toPatrol.x, toPatrol.z);
      throttle = 0.5;
    }

    const turn = Math.max(-1, Math.min(1, angleDiff(desiredHeading, this.ship.heading) * 2));
    this.ship.applyControls(turn, throttle, dt, false);
    this.ship.integrate(dt);

    this.ship.cannonCooldown -= dt;
    if (this.state === 'attack' && this.ship.cannonCooldown <= 0) {
      const bearingToTarget = Math.atan2(toPlayer.x, toPlayer.z);
      const relBearing = Math.abs(angleDiff(bearingToTarget, this.ship.heading));
      const isBroadsideOn = Math.abs(relBearing - Math.PI / 2) < BROADSIDE_FIRE_WINDOW;
      if (isBroadsideOn) {
        this.ship.cannonCooldown = this.ship.cannonReload * 1.5;
        fireCallback(this.ship);
      }
    }
  }
}

export interface CombatCallbacks {
  onPlayerHit: (damage: number) => void;
  onEnemySunk: (enemy: EnemyShip) => void;
  onGoldEarned: (amount: number) => void;
}

export class CombatSystem {
  cannonballs: Cannonball[] = [];
  enemies: EnemyShip[] = [];

  private scene: THREE.Scene;
  private callbacks: CombatCallbacks;
  private effects: Effects;
  private sound: SoundManager;

  constructor(scene: THREE.Scene, callbacks: CombatCallbacks, effects: Effects, sound: SoundManager) {
    this.scene = scene;
    this.callbacks = callbacks;
    this.effects = effects;
    this.sound = sound;
  }

  spawnEnemy(stats: ShipStats, pos: THREE.Vector3, goldReward: number) {
    const enemy = new EnemyShip(stats, pos, goldReward);
    this.scene.add(enemy.ship.group);
    this.enemies.push(enemy);
    return enemy;
  }

  /** Fires every mounted cannon on `ship`. Returns false if a player shot was
   * blocked by reload cooldown (enemies manage their own cooldown externally). */
  fireFromShip(ship: Ship, owner: 'player' | 'enemy'): boolean {
    if (ship.cannonCooldown > 0 && owner === 'player') return false;
    if (owner === 'player') ship.cannonCooldown = ship.cannonReload;

    const forward = ship.forwardDirection();
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    const speed = 26;
    const origin = ship.position.clone().add(new THREE.Vector3(0, 1.2, 0));

    const fireDir: Record<CannonSide, THREE.Vector3> = {
      front: forward.clone(),
      left: right.clone(),
      right: right.clone().multiplyScalar(-1),
    };

    let fired = false;
    (['front', 'left', 'right'] as CannonSide[]).forEach((side) => {
      const count = ship.loadout[side];
      if (count <= 0) return;
      const offsets = cannonMountOffsets(side, count, ship.scale);
      for (const offset of offsets) {
        const worldOffset = forward.clone().multiplyScalar(offset.z).add(right.clone().multiplyScalar(offset.x));
        const startPos = origin.clone().add(worldOffset);
        const vel = fireDir[side].clone().multiplyScalar(speed).add(new THREE.Vector3(0, 6, 0));
        this.cannonballs.push(new Cannonball(startPos, vel, ship.cannonDamage, owner, this.scene));
        this.effects.muzzleFlash(startPos, fireDir[side]);
        fired = true;
      }
    });

    if (fired) this.sound.cannonFire();
    return fired;
  }

  update(
    dt: number,
    playerShip: Ship,
    getWaveHeight: (x: number, z: number) => number,
  ) {
    for (const enemy of this.enemies) {
      if (enemy.ship.alive) {
        enemy.update(dt, playerShip.position, (ship) => this.fireFromShip(ship, 'enemy'));
      }
      enemy.ship.updateSink(dt);
      enemy.ship.updateHitFlash(dt);
      const h = getWaveHeight(enemy.ship.position.x, enemy.ship.position.z);
      enemy.ship.syncVisual(h, performance.now() / 1000);
    }

    for (const ball of this.cannonballs) {
      const h = getWaveHeight(ball.position.x, ball.position.z);
      ball.update(dt, h);
      if (!ball.alive && ball.hitWater) this.effects.splash(ball.position);
    }

    // collisions
    for (const ball of this.cannonballs) {
      if (!ball.alive) continue;
      if (ball.owner === 'player') {
        for (const enemy of this.enemies) {
          if (!enemy.ship.alive) continue;
          if (ball.position.distanceTo(enemy.ship.position) < 3) {
            enemy.ship.takeDamage(ball.damage);
            enemy.ship.flashHit();
            this.effects.impactSplinters(ball.position);
            this.sound.hitImpact();
            ball.alive = false;
            if (!enemy.ship.alive && !enemy.rewarded) {
              enemy.rewarded = true;
              this.effects.sinkExplosion(enemy.ship.position);
              this.sound.sink();
              this.callbacks.onEnemySunk(enemy);
            }
            break;
          }
        }
      } else if (ball.owner === 'enemy') {
        if (ball.position.distanceTo(playerShip.position) < 3) {
          const wasAlive = playerShip.alive;
          playerShip.takeDamage(ball.damage);
          playerShip.flashHit();
          this.effects.impactSplinters(ball.position);
          this.sound.hitImpact();
          this.callbacks.onPlayerHit(ball.damage);
          if (wasAlive && !playerShip.alive) {
            this.effects.sinkExplosion(playerShip.position);
            this.sound.sink();
          }
          ball.alive = false;
        }
      }
    }

    for (const ball of this.cannonballs) {
      if (!ball.alive) ball.dispose(this.scene);
    }
    this.cannonballs = this.cannonballs.filter((b) => b.alive);

    for (const enemy of this.enemies) {
      if (enemy.ship.sunk && enemy.ship.group.parent) {
        this.scene.remove(enemy.ship.group);
      }
    }
    this.enemies = this.enemies.filter((e) => !e.ship.sunk);
  }
}
