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

let sailTex: THREE.Texture | null = null;
/** Faint vertical cloth ribbing for sails. */
export function sailClothTexture(): THREE.Texture {
  if (sailTex) return sailTex;
  const { canvas, ctx } = makeCanvas(64);
  ctx.fillStyle = '#f4f1e6';
  ctx.fillRect(0, 0, 64, 64);
  for (let x = 0; x < 64; x += 5) {
    const shade = 210 + Math.random() * 25;
    ctx.strokeStyle = `rgba(${shade - 35}, ${shade - 30}, ${shade - 20}, 0.22)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 64);
    ctx.stroke();
  }
  sailTex = toTexture(canvas, [1, 2]);
  return sailTex;
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
