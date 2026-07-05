/** Plain-number port of the client's Ship.ts physics getters/methods (no
 * THREE.js/DOM) — this is what makes ship movement authoritative on the
 * server instead of trusting whatever a client claims its position is. */

export interface ShipStats {
  sailLevel: number;
  cannonLevel: number;
  hullLevel: number;
}

export interface ShipBody {
  x: number;
  z: number;
  heading: number;
  speed: number;
}

export function topSpeed(stats: ShipStats): number {
  return 6 + stats.sailLevel * 2.2;
}

export function acceleration(stats: ShipStats): number {
  return 3.5 + stats.sailLevel * 1.1;
}

export function turnRate(stats: ShipStats): number {
  return 1.5 - Math.min(stats.sailLevel * 0.03, 0.5);
}

export function cannonDamage(stats: ShipStats): number {
  return 12 + stats.cannonLevel * 6;
}

export function cannonReload(stats: ShipStats): number {
  return Math.max(0.35, 1.1 - stats.cannonLevel * 0.08);
}

export function maxHealthFor(stats: ShipStats): number {
  return 60 + stats.hullLevel * 40;
}

export function applyControls(
  body: ShipBody,
  stats: ShipStats,
  turn: number,
  throttle: number,
  dt: number,
  boosting: boolean,
) {
  body.heading += turn * turnRate(stats) * dt * (body.speed >= 0 ? 1 : -1);

  const targetSpeed = throttle * topSpeed(stats) * (throttle < 0 ? 0.5 : boosting ? 1.6 : 1);
  const accel = acceleration(stats) * (boosting ? 1.8 : 1);
  if (body.speed < targetSpeed) {
    body.speed = Math.min(targetSpeed, body.speed + accel * dt);
  } else {
    body.speed = Math.max(targetSpeed, body.speed - accel * dt);
  }
}

export function integrate(body: ShipBody, dt: number) {
  body.x += Math.sin(body.heading) * body.speed * dt;
  body.z += Math.cos(body.heading) * body.speed * dt;
}
