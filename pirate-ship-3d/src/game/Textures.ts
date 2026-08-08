import * as THREE from 'three';

/** Small canvas-generated surface textures — kept cached/shared so every hull,
 * sail, and island reuses the same GPU texture instead of generating one per
 * mesh. No binary assets, matching the rest of the project. */

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return { canvas, ctx: canvas.getContext('2d') as CanvasRenderingContext2D };
}

function toTexture(canvas: HTMLCanvasElement, repeat: [number, number] = [1, 1]): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(...repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let woodTex: THREE.Texture | null = null;
/** Neutral (near-white) wood grain — multiplied by each mesh's own material
 * color, so hull tint still varies per ship. */
export function woodGrainTexture(): THREE.Texture {
  if (woodTex) return woodTex;
  const { canvas, ctx } = makeCanvas(128);
  ctx.fillStyle = '#e9e4d8';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 46; i++) {
    const y = Math.random() * 128;
    const shade = 190 + Math.random() * 45;
    ctx.strokeStyle = `rgba(${shade - 55}, ${shade - 65}, ${shade - 85}, ${0.12 + Math.random() * 0.22})`;
    ctx.lineWidth = 0.6 + Math.random() * 1.8;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 8; x <= 128; x += 8) {
      ctx.lineTo(x, y + (Math.random() - 0.5) * 5);
    }
    ctx.stroke();
  }
  woodTex = toTexture(canvas, [2, 2]);
  return woodTex;
}

// --- sails ----------------------------------------------------------------
//
// The old sail texture was 64px of 0.22-alpha vertical hairlines. On screen a
// sail is ~80px tall, the lines landed sub-pixel, and the net effect was a
// uniform cream rectangle — measurably "textured", visibly cardboard. Sails
// are now built from a single 256px atlas holding TWO regions:
//
//   v 0.00 … 0.70   the mainsail: cloth + a heraldic device
//   v 0.72 … 1.00   plain cloth, used by the topsail, foresail and jib
//
// One atlas means every sail on a ship merges into one geometry and one draw
// call (see Ship.buildSails), and the device is what makes one captain's ship
// tell apart from another's at a glance — the thing the ship most lacked.

/** Cloth ground: warp/weft weave, vertical cloth-panel seams (a square sail is
 * sewn from vertical strips), horizontal reef bands, and a darker bolt-rope
 * hem so the sail has an edge instead of just stopping. */
function paintCloth(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rnd: () => number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  ctx.fillStyle = '#f3efe2';
  ctx.fillRect(x, y, w, h);

  // Weave: fine cross-hatch, low contrast, but dense enough to survive
  // downscaling into a mid-grey rather than vanishing.
  ctx.lineWidth = 1;
  for (let i = 0; i < h; i += 3) {
    ctx.strokeStyle = `rgba(196,188,168,${0.1 + rnd() * 0.08})`;
    ctx.beginPath();
    ctx.moveTo(x, y + i + 0.5);
    ctx.lineTo(x + w, y + i + 0.5);
    ctx.stroke();
  }

  // Cloth panels: a seam is two stitch lines with a slightly proud strip
  // between them, so it catches as a light/dark pair rather than one hairline.
  const panels = 7;
  for (let p = 1; p < panels; p++) {
    const px = x + (w * p) / panels;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, y);
    ctx.lineTo(px, y + h);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(158,148,126,0.5)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(px - 2, y);
    ctx.lineTo(px - 2, y + h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px + 2, y);
    ctx.lineTo(px + 2, y + h);
    ctx.stroke();
  }

  // Reef bands — the doubled strips of canvas a sail is shortened along.
  for (const f of [0.3, 0.56]) {
    const by = y + h * f;
    ctx.fillStyle = 'rgba(214,205,183,0.55)';
    ctx.fillRect(x, by, w, 5);
    ctx.strokeStyle = 'rgba(150,140,118,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, by + 0.5);
    ctx.lineTo(x + w, by + 0.5);
    ctx.moveTo(x, by + 4.5);
    ctx.lineTo(x + w, by + 4.5);
    ctx.stroke();
    // Reef points: the short lengths of line knotted through the band.
    for (let px = x + 6; px < x + w; px += 11) {
      ctx.strokeStyle = 'rgba(120,108,88,0.6)';
      ctx.beginPath();
      ctx.moveTo(px, by + 2);
      ctx.lineTo(px, by + 9);
      ctx.stroke();
    }
  }

  // Weathering: soft vertical staining so a dozen sails aren't one flat value.
  for (let i = 0; i < 14; i++) {
    const sx = x + rnd() * w;
    const g = ctx.createLinearGradient(sx, y, sx, y + h);
    g.addColorStop(0, 'rgba(150,136,110,0)');
    g.addColorStop(0.5 + rnd() * 0.3, `rgba(150,136,110,${0.06 + rnd() * 0.08})`);
    g.addColorStop(1, 'rgba(150,136,110,0)');
    ctx.fillStyle = g;
    ctx.fillRect(sx, y, 3 + rnd() * 12, h);
  }

  // Bolt-rope hem.
  ctx.strokeStyle = 'rgba(126,112,88,0.7)';
  ctx.lineWidth = 6;
  ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
  ctx.strokeStyle = 'rgba(90,78,58,0.5)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
  ctx.restore();
}

/** The heraldic devices. Deliberately BOLD silhouettes — a sail is ~60px tall
 * on a phone, so anything with fine linework turns to grey mush. Drawn in a
 * dark ink that the material's `color` then tints along with the cloth. */
const EMBLEMS: ((c: CanvasRenderingContext2D, s: number) => void)[] = [
  // 0 — skull. The eye sockets and nose are HOLES in a single even-odd path,
  // not `destination-out` erasures: erasing punched the cloth out too, so the
  // sockets came back as opaque black and the whole device read as one grey
  // blob on the sail instead of as a skull.
  (c, s) => {
    c.beginPath();
    c.ellipse(0, -0.1 * s, 0.34 * s, 0.36 * s, 0, 0, Math.PI * 2);
    c.ellipse(-0.14 * s, -0.12 * s, 0.11 * s, 0.13 * s, 0, 0, Math.PI * 2);
    c.ellipse(0.14 * s, -0.12 * s, 0.11 * s, 0.13 * s, 0, 0, Math.PI * 2);
    c.moveTo(0, 0.04 * s);
    c.lineTo(0.055 * s, 0.16 * s);
    c.lineTo(-0.055 * s, 0.16 * s);
    c.closePath();
    c.fill('evenodd');
    // Teeth drawn as separate bars, so the gaps between them come for free.
    for (let i = -2; i <= 2; i++) c.fillRect(i * 0.075 * s - 0.026 * s, 0.24 * s, 0.052 * s, 0.16 * s);
    c.fillRect(-0.2 * s, 0.2 * s, 0.4 * s, 0.06 * s);
  },
  // 1 — crossed bones
  (c, s) => {
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      c.save();
      c.rotate(a);
      c.fillRect(-0.42 * s, -0.055 * s, 0.84 * s, 0.11 * s);
      for (const e of [-0.42, 0.42])
        for (const o of [-0.09, 0.09]) {
          c.beginPath();
          c.arc(e * s, o * s, 0.085 * s, 0, Math.PI * 2);
          c.fill();
        }
      c.restore();
    }
  },
  // 2 — saltire cross
  (c, s) => {
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      c.save();
      c.rotate(a);
      c.fillRect(-0.46 * s, -0.09 * s, 0.92 * s, 0.18 * s);
      c.restore();
    }
  },
  // 3 — star
  (c, s) => {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = (i % 2 === 0 ? 0.46 : 0.19) * s;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const fn = i === 0 ? 'moveTo' : 'lineTo';
      c[fn](Math.cos(a) * r, Math.sin(a) * r);
    }
    c.closePath();
    c.fill();
  },
  // 4 — crescent, traced as one closed path (outer arc out, inner arc back)
  // for the same reason the skull is: erasing would take the cloth with it.
  (c, s) => {
    c.beginPath();
    c.arc(0, 0, 0.46 * s, Math.PI * 0.4, -Math.PI * 0.4);
    c.arc(0.22 * s, 0, 0.42 * s, -Math.PI * 0.34, Math.PI * 0.34, true);
    c.closePath();
    c.fill();
  },
  // 5 — anchor
  (c, s) => {
    c.lineCap = 'round';
    c.lineWidth = 0.11 * s;
    c.beginPath();
    c.moveTo(0, -0.34 * s);
    c.lineTo(0, 0.36 * s);
    c.moveTo(-0.3 * s, -0.18 * s);
    c.lineTo(0.3 * s, -0.18 * s);
    c.stroke();
    c.lineWidth = 0.1 * s;
    c.beginPath();
    c.arc(0, 0.16 * s, 0.32 * s, 0.15 * Math.PI, 0.85 * Math.PI);
    c.stroke();
    c.beginPath();
    c.arc(0, -0.4 * s, 0.11 * s, 0, Math.PI * 2);
    c.stroke();
  },
  // 6 — chevrons
  (c, s) => {
    c.lineWidth = 0.13 * s;
    c.lineJoin = 'miter';
    for (const o of [-0.28, 0.02, 0.32]) {
      c.beginPath();
      c.moveTo(-0.4 * s, (o + 0.2) * s);
      c.lineTo(0, o * s);
      c.lineTo(0.4 * s, (o + 0.2) * s);
      c.stroke();
    }
  },
  // 7 — compass rose
  (c, s) => {
    for (let i = 0; i < 4; i++) {
      c.save();
      c.rotate((i * Math.PI) / 2);
      c.beginPath();
      c.moveTo(0, -0.48 * s);
      c.lineTo(0.12 * s, 0);
      c.lineTo(0, 0.1 * s);
      c.lineTo(-0.12 * s, 0);
      c.closePath();
      c.fill();
      c.restore();
    }
    c.lineWidth = 0.05 * s;
    c.beginPath();
    c.arc(0, 0, 0.3 * s, 0, Math.PI * 2);
    c.stroke();
  },
];

export const EMBLEM_COUNT = EMBLEMS.length;

const sailAtlases = new Map<number, THREE.Texture>();

/** The sail atlas for one heraldic device. Cached per device, so a fleet of
 * twelve ships shares at most EMBLEM_COUNT textures no matter how many hulls
 * are on screen. */
export function sailAtlasTexture(emblem: number): THREE.Texture {
  const key = ((emblem % EMBLEMS.length) + EMBLEMS.length) % EMBLEMS.length;
  const cached = sailAtlases.get(key);
  if (cached) return cached;

  const S = 256;
  const { canvas, ctx } = makeCanvas(S);
  // Deterministic per-atlas noise so the same device always weathers the same.
  let seed = key * 9781 + 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  // CanvasTexture keeps flipY, so uv.v = 0 is the BOTTOM row of the canvas.
  // Main region uv.v 0…0.70  → canvas y  S*0.30 … S
  // Plain region uv.v 0.72…1 → canvas y  0 … S*0.28
  const mainY = S * 0.3;
  const mainH = S * 0.7;
  paintCloth(ctx, 0, mainY, S, mainH, rnd);
  paintCloth(ctx, 0, 0, S, S * 0.28, rnd);

  ctx.save();
  // Device sits in the upper-middle of the mainsail (uv.v ≈ 0.42), which is
  // where the sail is fullest and least occluded by the yard and the rigging.
  ctx.translate(S * 0.5, mainY + mainH * 0.42);
  // Big and dark on purpose. At chase distance a mainsail is ~70px tall; a
  // tasteful 30%-width crest at 60% opacity disappears entirely, which is what
  // the first cut of this did.
  ctx.fillStyle = 'rgba(38,31,26,0.92)';
  ctx.strokeStyle = 'rgba(38,31,26,0.92)';
  EMBLEMS[key](ctx, S * 0.62);
  ctx.restore();

  const tex = toTexture(canvas, [1, 1]);
  tex.anisotropy = 4;
  sailAtlases.set(key, tex);
  return tex;
}

let rockTex: THREE.Texture | null = null;
/** Mottled speckle pattern used for both island rock and grass caps (tinted
 * per-material via the base color). */
export function specklTexture(): THREE.Texture {
  if (rockTex) return rockTex;
  const { canvas, ctx } = makeCanvas(128);
  ctx.fillStyle = '#d9d3c2';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 128;
    const r = 0.6 + Math.random() * 2.2;
    const shade = 150 + Math.random() * 80;
    ctx.fillStyle = `rgba(${shade}, ${shade - 12}, ${shade - 35}, 0.35)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  rockTex = toTexture(canvas, [3, 3]);
  return rockTex;
}
