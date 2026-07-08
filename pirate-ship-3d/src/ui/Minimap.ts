import type { ShipSnapshot } from '../shared/protocol';

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
  ) {
    const ctx = this.ctx;
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

    for (const ship of ships) {
      if (!ship.alive || ship.id === yourId) continue;
      const p = toMinimap(ship.x, ship.z);
      if (p.x < -12 || p.x > SIZE + 12 || p.y < -12 || p.y > SIZE + 12) continue;
      let color = '#7fd0ff';
      let r = 2.5;
      if (ship.isBot) {
        color = ship.isBoss ? '#ff2d55' : ship.isRival ? '#ff8a2d' : '#e05050';
        r = ship.isBoss || ship.isRival ? 4 : 2.5;
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
  }
}
