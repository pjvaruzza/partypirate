import { randomUUID } from 'node:crypto';
import type { AmmoType, CannonLoadout, CannonSide } from '../../src/shared/protocol';

/** Plain-number port of Ship.ts's cannonMountOffsets — must stay in lockstep
 * with the client's copy so muzzle flashes line up with where the cannonball
 * actually spawned. */
export function cannonMountOffsets(side: CannonSide, count: number, scale: number): { x: number; z: number }[] {
  if (count <= 0) return [];
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const spread = (i: number) => (count === 1 ? 0.5 : i / (count - 1));

  if (side === 'front') {
    const half = 0.4 * scale;
    return Array.from({ length: count }, (_, i) => ({ x: lerp(-half, half, spread(i)), z: 1.85 * scale }));
  }
  const xSign = side === 'left' ? 1 : -1;
  return Array.from({ length: count }, (_, i) => ({
    x: xSign * 0.85 * scale,
    z: lerp(-1.3 * scale, 1.3 * scale, spread(i)),
  }));
}

export interface CannonballState {
  id: string;
  ownerId: string;
  ownerIsBot: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  damage: number;
  age: number;
  alive: boolean;
  hitWater: boolean;
  ammoType: AmmoType;
}

const GRAVITY = 9.8;
const CANNON_SPEED = 26;

export function spawnCannonballs(
  ownerId: string,
  ownerIsBot: boolean,
  x: number,
  z: number,
  heading: number,
  scale: number,
  loadout: CannonLoadout,
  damage: number,
  ammoType: AmmoType = 'round',
): CannonballState[] {
  const forwardX = Math.sin(heading);
  const forwardZ = Math.cos(heading);
  const rightX = forwardZ;
  const rightZ = -forwardX;

  const balls: CannonballState[] = [];
  (['front', 'left', 'right'] as CannonSide[]).forEach((side) => {
    const count = loadout[side];
    if (count <= 0) return;
    const dirX = side === 'front' ? forwardX : side === 'left' ? rightX : -rightX;
    const dirZ = side === 'front' ? forwardZ : side === 'left' ? rightZ : -rightZ;
    for (const offset of cannonMountOffsets(side, count, scale)) {
      const wx = x + forwardX * offset.z + rightX * offset.x;
      const wz = z + forwardZ * offset.z + rightZ * offset.x;
      balls.push({
        id: randomUUID(),
        ownerId,
        ownerIsBot,
        x: wx,
        y: 1.2,
        z: wz,
        vx: dirX * CANNON_SPEED,
        vy: 6,
        vz: dirZ * CANNON_SPEED,
        damage,
        age: 0,
        alive: true,
        hitWater: false,
        ammoType,
      });
    }
  });
  return balls;
}

export function updateCannonball(ball: CannonballState, dt: number) {
  ball.vy -= GRAVITY * dt;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.z += ball.vz * dt;
  ball.age += dt;
  if (ball.y <= 0) {
    ball.alive = false;
    ball.hitWater = true;
  } else if (ball.age > 6) {
    ball.alive = false;
  }
}

export interface BotAiState {
  state: 'patrol' | 'chase' | 'attack';
  patrolX: number;
  patrolZ: number;
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

const IDEAL_BROADSIDE_RANGE = 28;
const DEFAULT_FIRE_WINDOW_DEG = 35;
const DETECT_RANGE = 90;
const ATTACK_RANGE = 45;

export interface BotAiResult {
  turn: number;
  throttle: number;
  wantsFire: boolean;
}

/** Broadside-orbit AI, ported from Combat.ts's EnemyShip.update. Pass
 * `hasTarget: false` when no player is in the world so bots just patrol.
 * `fireWindowDeg` widens how far off pure-broadside a ship will still fire —
 * bosses get a more forgiving window than regular bots (see GameRoom.ts). */
export function updateBotAI(
  ai: BotAiState,
  body: { x: number; z: number; heading: number },
  targetX: number,
  targetZ: number,
  hasTarget: boolean,
  fireWindowDeg: number = DEFAULT_FIRE_WINDOW_DEG,
): BotAiResult {
  const toTargetX = targetX - body.x;
  const toTargetZ = targetZ - body.z;
  const distToTarget = Math.hypot(toTargetX, toTargetZ);

  if (hasTarget && distToTarget < DETECT_RANGE) {
    ai.state = distToTarget < ATTACK_RANGE ? 'attack' : 'chase';
  } else {
    ai.state = 'patrol';
  }

  let desiredHeading: number;
  let throttle: number;

  if (ai.state === 'attack') {
    const bearingToTarget = Math.atan2(toTargetX, toTargetZ);
    const perpA = bearingToTarget + Math.PI / 2;
    const perpB = bearingToTarget - Math.PI / 2;
    const dA = angleDiff(perpA, body.heading);
    const dB = angleDiff(perpB, body.heading);
    desiredHeading = Math.abs(dA) < Math.abs(dB) ? perpA : perpB;
    if (distToTarget > IDEAL_BROADSIDE_RANGE + 10) throttle = 0.85;
    else if (distToTarget < IDEAL_BROADSIDE_RANGE - 10) throttle = 0.3;
    else throttle = 0.55;
  } else if (ai.state === 'chase') {
    desiredHeading = Math.atan2(toTargetX, toTargetZ);
    throttle = 0.9;
  } else {
    const toPatrolX = ai.patrolX - body.x;
    const toPatrolZ = ai.patrolZ - body.z;
    if (Math.hypot(toPatrolX, toPatrolZ) < 10) {
      ai.patrolX = body.x + (Math.random() - 0.5) * 150;
      ai.patrolZ = body.z + (Math.random() - 0.5) * 150;
    }
    desiredHeading = Math.atan2(toPatrolX, toPatrolZ);
    throttle = 0.5;
  }

  const turn = Math.max(-1, Math.min(1, angleDiff(desiredHeading, body.heading) * 2));

  let wantsFire = false;
  if (ai.state === 'attack') {
    const bearingToTarget = Math.atan2(toTargetX, toTargetZ);
    const relBearing = Math.abs(angleDiff(bearingToTarget, body.heading));
    const fireWindow = (fireWindowDeg * Math.PI) / 180;
    wantsFire = Math.abs(relBearing - Math.PI / 2) < fireWindow;
  }

  return { turn, throttle, wantsFire };
}
