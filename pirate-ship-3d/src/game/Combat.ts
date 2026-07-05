import * as THREE from 'three';
import { Ship, cannonMountOffsets, type ShipStats, type CannonSide } from './Ship';

const GRAVITY = 9.8;

export class Cannonball {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  mesh: THREE.Mesh;
  damage: number;
  owner: 'player' | 'enemy';
  alive = true;
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
    const geo = new THREE.SphereGeometry(0.22, 8, 8);
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
    if (this.position.y <= waterHeight || this.age > 6) {
      this.alive = false;
    }
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.mesh);
  }
}

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

  update(dt: number, playerPos: THREE.Vector3, fireCallback: (heading: number, pos: THREE.Vector3) => void) {
    if (!this.ship.alive) return;
    const distToPlayer = this.ship.position.distanceTo(playerPos);
    const detectRange = 90;
    const attackRange = 45;

    if (distToPlayer < detectRange) {
      this.state = distToPlayer < attackRange ? 'attack' : 'chase';
    } else {
      this.state = 'patrol';
    }

    let targetPos = this.patrolTarget;
    let throttle = 0.5;
    if (this.state === 'chase') {
      targetPos = playerPos;
      throttle = 0.9;
    } else if (this.state === 'attack') {
      targetPos = playerPos;
      throttle = 0.6;
    } else if (this.ship.position.distanceTo(this.patrolTarget) < 10) {
      this.patrolTarget = this.ship.position.clone().add(
        new THREE.Vector3((Math.random() - 0.5) * 150, 0, (Math.random() - 0.5) * 150),
      );
    }

    const toTarget = new THREE.Vector3().subVectors(targetPos, this.ship.position);
    const desiredHeading = Math.atan2(toTarget.x, toTarget.z);
    let diff = desiredHeading - this.ship.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const turn = Math.max(-1, Math.min(1, diff * 2));

    this.ship.applyControls(turn, throttle, dt, false);
    this.ship.integrate(dt);

    this.ship.cannonCooldown -= dt;
    if (this.state === 'attack' && this.ship.cannonCooldown <= 0) {
      this.ship.cannonCooldown = this.ship.cannonReload * 1.5;
      fireCallback(this.ship.heading, this.ship.position);
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

  constructor(scene: THREE.Scene, callbacks: CombatCallbacks) {
    this.scene = scene;
    this.callbacks = callbacks;
  }

  spawnEnemy(stats: ShipStats, pos: THREE.Vector3, goldReward: number) {
    const enemy = new EnemyShip(stats, pos, goldReward);
    this.scene.add(enemy.ship.group);
    this.enemies.push(enemy);
    return enemy;
  }

  fireFromShip(ship: Ship, owner: 'player' | 'enemy') {
    if (ship.cannonCooldown > 0 && owner === 'player') return;
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

    (['front', 'left', 'right'] as CannonSide[]).forEach((side) => {
      const count = ship.loadout[side];
      if (count <= 0) return;
      const offsets = cannonMountOffsets(side, count, ship.scale);
      for (const offset of offsets) {
        const worldOffset = forward.clone().multiplyScalar(offset.z).add(right.clone().multiplyScalar(offset.x));
        const startPos = origin.clone().add(worldOffset);
        const vel = fireDir[side].clone().multiplyScalar(speed).add(new THREE.Vector3(0, 6, 0));
        this.cannonballs.push(new Cannonball(startPos, vel, ship.cannonDamage, owner, this.scene));
      }
    });
  }

  private fireEnemyCannon = (heading: number, pos: THREE.Vector3) => {
    const dir = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    const speed = 22;
    const origin = pos.clone().add(new THREE.Vector3(0, 1.2, 0));
    const vel = dir.multiplyScalar(speed).add(new THREE.Vector3(0, 5.5, 0));
    this.cannonballs.push(new Cannonball(origin, vel, 8, 'enemy', this.scene));
  };

  update(
    dt: number,
    playerShip: Ship,
    getWaveHeight: (x: number, z: number) => number,
  ) {
    for (const enemy of this.enemies) {
      if (!enemy.ship.alive) continue;
      enemy.update(dt, playerShip.position, this.fireEnemyCannon);
      const h = getWaveHeight(enemy.ship.position.x, enemy.ship.position.z);
      enemy.ship.syncVisual(h, performance.now() / 1000);
    }

    for (const ball of this.cannonballs) {
      const h = getWaveHeight(ball.position.x, ball.position.z);
      ball.update(dt, h);
    }

    // collisions
    for (const ball of this.cannonballs) {
      if (!ball.alive) continue;
      if (ball.owner === 'player') {
        for (const enemy of this.enemies) {
          if (!enemy.ship.alive) continue;
          if (ball.position.distanceTo(enemy.ship.position) < 3) {
            enemy.ship.takeDamage(ball.damage);
            ball.alive = false;
            if (!enemy.ship.alive && !enemy.rewarded) {
              enemy.rewarded = true;
              this.callbacks.onEnemySunk(enemy);
            }
            break;
          }
        }
      } else if (ball.owner === 'enemy') {
        if (ball.position.distanceTo(playerShip.position) < 3) {
          playerShip.takeDamage(ball.damage);
          this.callbacks.onPlayerHit(ball.damage);
          ball.alive = false;
        }
      }
    }

    for (const ball of this.cannonballs) {
      if (!ball.alive) ball.dispose(this.scene);
    }
    this.cannonballs = this.cannonballs.filter((b) => b.alive);

    for (const enemy of this.enemies) {
      if (!enemy.ship.alive && enemy.ship.group.parent) {
        this.scene.remove(enemy.ship.group);
      }
    }
    this.enemies = this.enemies.filter((e) => e.ship.alive);
  }
}
