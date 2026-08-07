import type { OutpostInfo, ShipSnapshot } from '../shared/protocol';

const SIZE = 150;
const RADIUS = SIZE / 2;
/** World units shown from center to edge — a local "nearby" radar, not the
 * whole map. */
const WORLD_RANGE = 240;
const SCALE = RADIUS / WORLD_RANGE;

export interface MinimapIsland {
  x: number;
  z: number;
  radius: number;
  isHomePort: boolean;
}

export interface MinimapPickup {
  x: number;
  z: number;
  value: number;
}

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  dirX: number,
  dirZ: number,
  len: number,
  halfWidth: number,
  color: string,
) {
  const tipX = cx + dirX * len;
  const tipY = cy + dirZ * len;
  const rightX = dirZ;
  const rightZ = -dirX;
  const backX = cx - dirX * (len * 0.6);
  const backY = cy - dirZ * (len * 0.6);
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(backX + rightX * halfWidth, backY + rightZ * halfWidth);
  ctx.lineTo(backX - rightX * halfWidth, backY - rightZ * halfWidth);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** A world-north-up radar: nearby islands (home port marked gold), other
 * ships as color-coded blips, and an edge arrow pointing toward home port
 * when it's out of the shown range. Player heading is drawn as the center
 * triangle so it also doubles as a compass. */
export class Minimap {
  private ctx: CanvasRenderingContext2D;

  constructor() {
    const canvas = document.getElementById('minimap') as HTMLCanvasElement;
    canvas.width = SIZE;
    canvas.height = SIZE;
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  }

  render(
    playerX: number,
    playerZ: number,
    playerHeading: number,
    islands: MinimapIsland[],
    ships: ShipSnapshot[],
    yourId: string,
    crates: MinimapPickup[] = [],
    salvage: MinimapPickup[] = [],
    outposts: OutpostInfo[] = [],
  ) {
    const ctx = this.ctx;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
    ctx.clearRect(0, 0, SIZE, SIZE);

    ctx.save();
    ctx.beginPath();
    ctx.arc(RADIUS, RADIUS, RADIUS, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(8, 22, 36, 0.78)';
    ctx.fillRect(0, 0, SIZE, SIZE);

    const toMinimap = (wx: number, wz: number) => ({
      x: RADIUS + (wx - playerX) * SCALE,
      y: RADIUS + (wz - playerZ) * SCALE,
    });

    for (const isl of islands) {
      const p = toMinimap(isl.x, isl.z);
      const r = Math.max(2, isl.radius * SCALE);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isl.isHomePort ? '#e8c34a' : '#3f7d3a';
      ctx.fill();
      if (isl.isHomePort) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#fff3c4';
        ctx.stroke();
      }
    }

    // Capturable outposts. Drawn over the island discs above so ownership
    // reads at a glance: green = yours (bank and refit here), red = another
    // captain's, white = neutral and free to take. A dashed halo means a
    // garrison is out and the island is being fought over right now.
    for (const op of outposts) {
      const p = toMinimap(op.x, op.z);
      if (p.x < -30 || p.x > SIZE + 30 || p.y < -30 || p.y > SIZE + 30) continue;
      const r = Math.max(3, op.radius * SCALE);
      const color = op.yours ? '#3ddc84' : op.ownerName ? '#ff4d4d' : '#dfe7ec';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = op.yours ? 'rgba(61, 220, 132, 0.55)' : op.ownerName ? 'rgba(255, 77, 77, 0.5)' : 'rgba(223, 231, 236, 0.35)';
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = color;
      ctx.stroke();
      if (op.garrisonRemaining > 0) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 3 + pulse * 3.5, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 160, 60, ${0.75 * (1 - pulse * 0.6)})`;
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }
    }

    // Drifting cargo crates: small, muted, square. Deliberately the dullest
    // marker on the radar so that salvage below can't be mistaken for one —
    // a crate is worth a detour, a dead captain's hold is worth a fight.
    for (const crate of crates) {
      const p = toMinimap(crate.x, crate.z);
      if (p.x < -6 || p.x > SIZE + 6 || p.y < -6 || p.y > SIZE + 6) continue;
      // Small and desaturated on purpose: there are a lot of crates in the
      // world and at 5px each they turned the radar into confetti.
      ctx.fillStyle = 'rgba(174, 133, 78, 0.7)';
      ctx.strokeStyle = 'rgba(18, 11, 4, 0.7)';
      ctx.lineWidth = 0.8;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      ctx.strokeRect(p.x - 2, p.y - 2, 4, 4);
    }

    // Spilled unbanked gold. The single most interesting thing that can
    // exist in the world while it exists, so it gets the only animated
    // marker on the radar: a bright coin with an expanding pulse ring, and
    // a bigger dot for a bigger pile.
    for (const pile of salvage) {
      const p = toMinimap(pile.x, pile.z);
      if (p.x < -14 || p.x > SIZE + 14 || p.y < -14 || p.y > SIZE + 14) continue;
      const r = 3 + Math.min(2.6, pile.value / 260);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 2 + pulse * 5, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 226, 130, ${0.55 * (1 - pulse)})`;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd034';
      ctx.fill();
      ctx.strokeStyle = '#fff6d0';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    for (const ship of ships) {
      if (!ship.alive || ship.id === yourId) continue;
      const p = toMinimap(ship.x, ship.z);
      if (p.x < -12 || p.x > SIZE + 12 || p.y < -12 || p.y > SIZE + 12) continue;
      let color = '#7fd0ff';
      let r = 2.5;
      if (ship.isBot) {
        color = ship.isBoss ? '#ff2d55' : ship.isRival ? '#ff8a2d' : ship.isGarrison ? '#ffa63c' : '#e05050';
        r = ship.isBoss || ship.isRival ? 4 : ship.isGarrison ? 3.2 : 2.5;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }

    drawTriangle(ctx, RADIUS, RADIUS, Math.sin(playerHeading), Math.cos(playerHeading), 7, 4.5, '#ffffff');

    ctx.restore();

    ctx.beginPath();
    ctx.arc(RADIUS, RADIUS, RADIUS - 1, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();

    const home = islands.find((i) => i.isHomePort);
    if (home) {
      const dx = home.x - playerX;
      const dz = home.z - playerZ;
      const dist = Math.hypot(dx, dz);
      if (dist * SCALE > RADIUS - 8 && dist > 0.001) {
        const dirX = dx / dist;
        const dirZ = dz / dist;
        const ex = RADIUS + dirX * (RADIUS - 10);
        const ey = RADIUS + dirZ * (RADIUS - 10);
        drawTriangle(ctx, ex, ey, dirX, dirZ, 8, 5, '#e8c34a');
      }
    }

    // Nearest off-radar salvage gets its own edge marker. Salvage expires,
    // so "there is loot that way, go now" is time-critical information and
    // the one thing worth pointing at from beyond the radar's range besides
    // home. Drawn as a pulsing coin rather than a triangle so it can't be
    // confused with the home-port arrow above.
    let nearest: { p: MinimapPickup; dist: number } | null = null;
    for (const pile of salvage) {
      const d = Math.hypot(pile.x - playerX, pile.z - playerZ);
      if (d * SCALE <= RADIUS - 8) continue;
      if (!nearest || d < nearest.dist) nearest = { p: pile, dist: d };
    }
    if (nearest && nearest.dist > 0.001) {
      const dirX = (nearest.p.x - playerX) / nearest.dist;
      const dirZ = (nearest.p.z - playerZ) / nearest.dist;
      const ex = RADIUS + dirX * (RADIUS - 7);
      const ey = RADIUS + dirZ * (RADIUS - 7);
      ctx.beginPath();
      ctx.arc(ex, ey, 3.2 + pulse * 1.6, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd034';
      ctx.fill();
      ctx.strokeStyle = 'rgba(20, 12, 4, 0.9)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}
