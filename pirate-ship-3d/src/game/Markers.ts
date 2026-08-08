import * as THREE from 'three';
import { GeoBuilder } from './GeoBuilder';
import { woodGrainTexture } from './Textures';

/**
 * The two objects the new economy hangs off: the gold you could lose, and the
 * water you're safe in. Both shipped as placeholders from a gameplay pass —
 * an additive disc and an additive ring — and both blew out to flat white
 * ellipses over the rebuilt ocean, which now draws its own bright foam.
 *
 * The rule applied to both: NO large flat additive surfaces over water.
 * Additive is reserved for small, shaped, sub-pixel-bright things (a coin
 * glint, a thin light shaft). Anything covering real screen area is normal
 * alpha with structure in it, so it sits ON the sea instead of erasing it.
 */

// --- salvage ---------------------------------------------------------------

const _c = new THREE.Color();

/** Shared across every pile: staved barrels, split planks and a burst chest,
 * baked into one geometry. */
let debrisGeo: THREE.BufferGeometry | null = null;
function salvageDebrisGeometry(): THREE.BufferGeometry {
  if (debrisGeo) return debrisGeo;
  const b = new GeoBuilder();
  const BOX = new THREE.BoxGeometry(1, 1, 1);
  const CYL = new THREE.CylinderGeometry(1, 1, 1, 8);
  const place = (x: number, y: number, z: number, rx: number, ry: number, rz: number, sx: number, sy: number, sz: number) =>
    new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(sx, sy, sz),
    );

  // Lighter than a hull's planking on purpose: at half a wave's height in
  // open water, dark wood reads as a rock, not as wreckage.
  const wood = _c.clone().setHex(0x8f6636);
  const woodDark = _c.clone().setHex(0x5a3f22);
  const iron = _c.clone().setHex(0x3a332c);
  const gold = _c.clone().setHex(0xf2c14a);

  // A burst chest, lid hanging open, gold heaped out of it.
  b.add(BOX, place(0, 0.3, 0, 0, 0.35, 0.06, 0.86, 0.46, 0.6), wood);
  b.add(BOX, place(0, 0.53, 0, 0, 0.35, 0.06, 0.9, 0.07, 0.64), woodDark);
  b.add(BOX, place(-0.15, 0.7, -0.31, -1.15, 0.35, 0.06, 0.84, 0.08, 0.53), wood);
  b.add(BOX, place(0, 0.3, 0.31, 0, 0.35, 0.06, 0.12, 0.5, 0.07), iron);
  // The heap of coin inside — the point of the whole object.
  b.add(BOX, place(0, 0.56, 0.02, 0, 0.35, 0.06, 0.7, 0.12, 0.46), gold);
  b.add(BOX, place(0.05, 0.64, -0.02, 0.1, 0.5, 0.12, 0.42, 0.1, 0.3), gold);

  // Half-submerged barrel alongside.
  b.add(CYL, place(0.98, 0.18, 0.46, 1.45, 0.4, 0.2, 0.3, 0.6, 0.3), wood);
  b.add(CYL, place(0.98, 0.18, 0.46, 1.45, 0.4, 0.2, 0.32, 0.09, 0.32), iron);

  // Splintered planks drifting off.
  b.add(BOX, place(-1.05, 0.11, -0.34, 0.06, 0.9, 0.03, 1.25, 0.08, 0.24), wood);
  b.add(BOX, place(-0.68, 0.1, 0.7, -0.04, -0.5, 0.02, 1.0, 0.07, 0.2), woodDark);

  BOX.dispose();
  CYL.dispose();
  debrisGeo = b.build();
  return debrisGeo;
}

/** Loose coin: real doubloons, not glowing icosahedra. Flattened cylinders,
 * scattered and tilted, merged into one geometry. Metallic + rough enough to
 * catch the sun as a moving highlight instead of reading as a light source. */
let coinGeo: THREE.BufferGeometry | null = null;
function salvageCoinGeometry(): THREE.BufferGeometry {
  if (coinGeo) return coinGeo;
  const b = new GeoBuilder();
  const CYL = new THREE.CylinderGeometry(1, 1, 1, 10);
  let seed = 7717;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + rnd() * 0.6;
    const r = 0.5 + rnd() * 0.95;
    // Coins were 0.085-0.135 across, i.e. ~3px at chase distance, and the
    // "spilled gold" read as a few yellow specks. A doubloon on this scale is
    // deliberately oversized.
    const s = 0.15 + rnd() * 0.09;
    b.add(
      CYL,
      new THREE.Matrix4().compose(
        new THREE.Vector3(Math.cos(a) * r, 0.16 + rnd() * 0.3, Math.sin(a) * r),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 1.4 - 0.7, rnd() * 3, rnd() * 1.4 - 0.7)),
        new THREE.Vector3(s, 0.03, s),
      ),
      _c.clone().setHex(0xffd15c).multiplyScalar(0.85 + rnd() * 0.3),
    );
  }
  CYL.dispose();
  coinGeo = b.build();
  return coinGeo;
}

/** Soft slick of scattered flotsam and disturbed water. Vertex alpha, NORMAL
 * blending — the old version was a 2.2-unit additive disc at 0.28 alpha,
 * which over bright water saturated to a hard white ellipse and read as a
 * rendering bug rather than as loot. */
let slickGeo: THREE.BufferGeometry | null = null;
function salvageSlickGeometry(): THREE.BufferGeometry {
  if (slickGeo) return slickGeo;
  const RING = 28;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const rings = [
    { r: 0.0, a: 0.42 },
    { r: 1.05, a: 0.3 },
    { r: 1.75, a: 0.12 },
    { r: 2.35, a: 0.0 },
  ];
  for (let k = 0; k < rings.length; k++) {
    for (let i = 0; i <= RING; i++) {
      const a = (i / RING) * Math.PI * 2;
      // Irregular outline: a perfect circle is what made it read as a decal.
      const wob = 1 + Math.sin(a * 3 + k) * 0.1 + Math.sin(a * 5.7) * 0.06;
      pos.push(Math.cos(a) * rings[k].r * wob, 0, Math.sin(a) * rings[k].r * wob);
      col.push(1, 0.93, 0.72, rings[k].a);
    }
  }
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < RING; i++) {
      const a = k * (RING + 1) + i;
      const b = a + RING + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  slickGeo = g;
  return g;
}

/** A short tapered shaft of warm light so a pile is findable across open
 * water. Additive — but small: at 5.5 units tall and 0.7 wide at the top with
 * a 0.5 base alpha it was three white columns running off the top of frame
 * and straight through the horizon, which is the same failure mode as the
 * additive disc it replaced. 1.5 tall, 0.42 wide at the base and a saturated
 * amber (additive white just goes white over a bright sky) reads as a shimmer
 * over the wreckage instead of a searchlight. */
let beamGeo: THREE.BufferGeometry | null = null;
function salvageBeamGeometry(): THREE.BufferGeometry {
  if (beamGeo) return beamGeo;
  const SEG = 10;
  const H = 1.15;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let lvl = 0; lvl < 2; lvl++) {
    const f = lvl;
    const r = 0.42 * (1 - f) + 0.22 * f;
    const y = 0.1 + H * f;
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      col.push(1, 0.58, 0.1, lvl === 0 ? 0.4 : 0);
    }
  }
  for (let i = 0; i < SEG; i++) {
    const a = i;
    const b = i + SEG + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  beamGeo = g;
  return g;
}

let salvageMats: {
  debris: THREE.MeshStandardMaterial;
  coin: THREE.MeshStandardMaterial;
  slick: THREE.MeshBasicMaterial;
  beam: THREE.MeshBasicMaterial;
} | null = null;
function salvageMaterials() {
  if (salvageMats) return salvageMats;
  salvageMats = {
    debris: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      map: woodGrainTexture(),
      roughness: 0.85,
    }),
    coin: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      metalness: 0.95,
      roughness: 0.28,
      // A whisper of self-illumination so the coins still glint on the
      // shadowed side of a swell, without the old material's emissive 0.85
      // that turned the whole cluster into a lamp.
      emissive: 0x3a2400,
    }),
    slick: new THREE.MeshBasicMaterial({
      color: 0xffe9b8,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    }),
    beam: new THREE.MeshBasicMaterial({
      color: 0xffb43c,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    }),
  };
  return salvageMats;
}

export interface SalvageVisual {
  group: THREE.Group;
  spin: THREE.Group;
  beam: THREE.Mesh;
}

/** A floating salvage pile: burst chest + barrel + planks, a scatter of loose
 * doubloons turning in the swell, a soft slick, and a narrow light shaft.
 * Four draw calls; the geometry is shared across every pile in the world. */
export function buildSalvageMarker(): SalvageVisual {
  const mats = salvageMaterials();
  const group = new THREE.Group();

  const slick = new THREE.Mesh(salvageSlickGeometry(), mats.slick);
  slick.position.y = 0.05;
  slick.renderOrder = 1;
  group.add(slick);

  const debris = new THREE.Mesh(salvageDebrisGeometry(), mats.debris);
  debris.castShadow = true;
  group.add(debris);

  const spin = new THREE.Group();
  const coins = new THREE.Mesh(salvageCoinGeometry(), mats.coin);
  coins.castShadow = true;
  spin.add(coins);
  group.add(spin);

  const beam = new THREE.Mesh(salvageBeamGeometry(), mats.beam);
  beam.renderOrder = 2;
  group.add(beam);

  return { group, spin, beam };
}

/** Per-frame: bob the debris on the swell and turn the coins. `t` is elapsed
 * seconds; `phase` keeps piles from pulsing in lockstep. */
export function updateSalvageMarker(vis: SalvageVisual, t: number, phase: number) {
  vis.spin.rotation.y = t * 0.7 + phase;
  vis.spin.position.y = Math.sin(t * 1.9 + phase) * 0.05;
  const mat = vis.beam.material as THREE.MeshBasicMaterial;
  mat.opacity = 0.72 + Math.sin(t * 1.6 + phase) * 0.22;
}

// --- sanctuary ward --------------------------------------------------------

let wardTex: THREE.Texture | null = null;
/**
 * The pattern on the ward curtain.
 *
 * First cut of this was crisp 3px chevrons at 0.9 alpha. Screenshotted at
 * chase distance they read as white claw-marks raked across the water —
 * exactly the "obvious debug overlay" failure the additive ring had, in a new
 * costume. What actually reads as a field of protective light is soft vertical
 * shafts of varying width with no hard edges anywhere, so the pattern gives
 * the curtain motion and body without ever drawing a line.
 */
function wardTexture(): THREE.Texture {
  if (wardTex) return wardTex;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  // A dim base so the curtain is continuous rather than a set of stripes with
  // holes between them.
  ctx.fillStyle = 'rgba(255,255,255,0.42)';
  ctx.fillRect(0, 0, 128, 32);
  let seed = 4211;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 9; i++) {
    const x = (i / 9) * 128 + rnd() * 8;
    const w = 5 + rnd() * 11;
    const g = ctx.createLinearGradient(x - w, 0, x + w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, `rgba(255,255,255,${0.3 + rnd() * 0.3})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - w, 0, w * 2, 32);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(3, 1);
  wardTex = tex;
  return tex;
}

let wardWallGeo: THREE.BufferGeometry | null = null;
function wardWallGeometry(): THREE.BufferGeometry {
  if (wardWallGeo) return wardWallGeo;
  const SEG = 36;
  const R = 3.1;
  const H = 0.95;
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let lvl = 0; lvl < 3; lvl++) {
    const f = lvl / 2;
    const y = f * H;
    // Brightest right where it leaves the water, gone by the top: a wall of
    // light rising out of the sea rather than a floating hoop.
    const a = lvl === 0 ? 0.6 : lvl === 1 ? 0.22 : 0;
    for (let i = 0; i <= SEG; i++) {
      const th = (i / SEG) * Math.PI * 2;
      pos.push(Math.cos(th) * R, y, Math.sin(th) * R);
      uv.push(i / SEG, f);
      col.push(0.72, 0.94, 1, a);
    }
  }
  for (let lvl = 0; lvl < 2; lvl++) {
    for (let i = 0; i < SEG; i++) {
      const a = lvl * (SEG + 1) + i;
      const b = a + SEG + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  wardWallGeo = g;
  return g;
}

let wardDiscGeo: THREE.BufferGeometry | null = null;
/** The water inside the ward: a soft pale disc brightest at the rim, so the
 * boundary reads without a hard additive donut sitting on the surface. */
function wardDiscGeometry(): THREE.BufferGeometry {
  if (wardDiscGeo) return wardDiscGeo;
  const SEG = 40;
  const rings = [
    { r: 0.0, a: 0.0 },
    { r: 1.9, a: 0.04 },
    { r: 2.8, a: 0.14 },
    { r: 3.1, a: 0.26 },
    { r: 3.45, a: 0.0 },
  ];
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k < rings.length; k++) {
    for (let i = 0; i <= SEG; i++) {
      const th = (i / SEG) * Math.PI * 2;
      pos.push(Math.cos(th) * rings[k].r, 0, Math.sin(th) * rings[k].r);
      uv.push(0.5, 0.5); // solid region of the ward texture is unused here
      col.push(0.78, 0.95, 1, rings[k].a);
    }
  }
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < SEG; i++) {
      const a = k * (SEG + 1) + i;
      const b = a + SEG + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  wardDiscGeo = g;
  return g;
}

let wardMats: { wall: THREE.MeshBasicMaterial; disc: THREE.MeshBasicMaterial } | null = null;
function wardMaterials() {
  if (wardMats) return wardMats;
  wardMats = {
    wall: new THREE.MeshBasicMaterial({
      color: 0xbfeaff,
      map: wardTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    }),
    disc: new THREE.MeshBasicMaterial({
      color: 0xcdf0ff,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    }),
  };
  return wardMats;
}

export interface WardVisual {
  group: THREE.Group;
  wall: THREE.Mesh;
}

/**
 * The harbour ward: the ring under any ship that can't deal or take damage.
 *
 * Was a flat additive `RingGeometry` at 0.4 opacity, which over the rebuilt
 * ocean's foam read as the same blown-out white and fought the wake. Now it's
 * a low curtain of light standing out of the water with a patterned, slowly
 * rotating surface plus a soft disc under the hull, all on normal alpha. It
 * reads as something *doing* something, and it can't saturate.
 *
 * Two draw calls per protected ship, shared geometry and materials.
 */
export function buildWardMarker(): WardVisual {
  const mats = wardMaterials();
  const group = new THREE.Group();

  const disc = new THREE.Mesh(wardDiscGeometry(), mats.disc);
  disc.position.y = 0.05;
  disc.renderOrder = 1;
  group.add(disc);

  const wall = new THREE.Mesh(wardWallGeometry(), mats.wall);
  wall.renderOrder = 2;
  group.add(wall);

  return { group, wall };
}

/** Scrolls the chevrons round the curtain and breathes the whole thing. The
 * texture offset lives on the SHARED material, so this costs one uniform
 * write per frame no matter how many wards are up. */
export function updateWardMarkers(t: number) {
  if (!wardMats) return;
  const tex = wardMats.wall.map;
  if (tex) tex.offset.x = -t * 0.06;
  const pulse = 0.78 + Math.sin(t * 1.7) * 0.16;
  wardMats.wall.opacity = pulse;
  wardMats.disc.opacity = pulse;
}
