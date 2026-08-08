import * as THREE from 'three';
import { woodGrainTexture, sailAtlasTexture, EMBLEM_COUNT } from './Textures';
import { GeoBuilder } from './GeoBuilder';

export interface ShipStats {
  sailLevel: number; // affects top speed & acceleration
  cannonLevel: number; // affects damage & reload speed
  hullLevel: number; // affects max health
}

export type CannonSide = 'front' | 'left' | 'right';

export interface CannonLoadout {
  front: number;
  left: number;
  right: number;
}

const DEFAULT_LOADOUT: CannonLoadout = { front: 0, left: 1, right: 1 };

/** Local-space mount points (hull x/z) for a given side + count, shared by the
 * ship's visual cannon meshes and the combat system's firing origins so the
 * two stay in sync. */
export function cannonMountOffsets(side: CannonSide, count: number, scale: number): { x: number; z: number }[] {
  if (count <= 0) return [];
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const spread = (i: number) => (count === 1 ? 0.5 : i / (count - 1));

  if (side === 'front') {
    const half = 0.4 * scale;
    return Array.from({ length: count }, (_, i) => ({
      x: lerp(-half, half, spread(i)),
      z: 1.85 * scale,
    }));
  }

  // Flipped relative to the "true" right-hand rule: the chase camera trails
  // behind and looks at the ship, which mirrors screen left/right relative
  // to the hull's own local axes. This keeps Port/Starboard matching what
  // the player actually sees on screen while sailing.
  const xSign = side === 'left' ? 1 : -1;
  return Array.from({ length: count }, (_, i) => ({
    x: xSign * 0.85 * scale,
    z: lerp(-1.3 * scale, 1.3 * scale, spread(i)),
  }));
}

// --- hull form (all multiplied by the ship's `scale`) ---------------------
// These match cannonMountOffsets above: max half-beam 0.85, length ±2.0, so
// side cannons at x=±0.85 sit on the widest part of the hull and the bow
// cannon at z=1.85 sits just inside the stem.
//
// INVARIANT: hull-local y=0 IS the waterline. There is deliberately no
// separate "waterline offset" fudge factor any more — that constant existed
// twice, was mis-tuned twice, and made it impossible to reason about how much
// hull was actually meant to show. Draft is what's under the water, freeboard
// is what's above it, full stop, and the boot-top stripe is painted at y=0.
const HULL_HALF_LENGTH = 2.0;
const HULL_MAX_BEAM = 0.85;
/** Keel depth below the waterline amidships. */
const HULL_DRAFT = 0.62;
/** Rail (gunwale) height above the waterline amidships. Together with
 * HULL_DRAFT this gives a hull 1.36 deep on a 4.0 hull — L/D ≈ 2.9, in the
 * range of a real small sailing vessel. The old 0.42/0.50 pair gave L/D 4.3,
 * a dish, and only 0.50 of it showed above the water. */
const HULL_FREEBOARD = 0.74;
/** How far the deck sits BELOW the rail, i.e. the height of the bulwark that
 * stands proud of the deck all round. This is the fix for "you're looking
 * down into an open bowl": previously the deck *was* the sheer line, so from
 * the chase camera's ~23° downward pitch the entire deck interior was in
 * plain view and the only thing reading as hull was a thin rim. With a
 * bulwark the deck is recessed and most of what you see from behind is hull
 * wall. */
const BULWARK_HEIGHT = 0.34;
const DECK_CAMBER = 0.07;

/** 0/1/2 = sloop/brigantine/galleon. Previously every class was the exact
 * same hull, scaled — a galleon was just a bigger sloop. This shapes the
 * beam and stern differently per class instead of only the uniform `scale`
 * already applied everywhere. */
export type HullClass = 0 | 1 | 2;

/** Everything painted on a hull. Previously a ship was one flat `hullColor`
 * plus a barely-visible boot-top, which is why a dozen hulls read as one
 * silhouette in brown: nothing on the model carried a second value, let alone
 * a second hue. */
export interface ShipLivery {
  /** Topside planking. */
  plank: number;
  /** Antifouling below the waterline. */
  bottom: number;
  /** Boot-top stripe straddling the waterline. */
  boot: number;
  /** Rubbing strake / wale — the dark band at mid-freeboard. */
  wale: number;
  /** The painted topsides above the deck line. Broad, so it wants to be a
   * quiet colour; the accent does the shouting. */
  bulwark: number;
  /** The sheer stripe, and with it the pennant, gunport lids, taffrail and
   * stern board. The ship's identity colour: it traces the sheer curve, which
   * is the one line on a hull the eye follows, so it reads even when the ship
   * is 40px wide. Deliberately confined to a ~0.1-unit band — the first cut
   * of this painted the whole bulwark and every hull turned into a bathtub
   * with a fluorescent rim. */
  accent: number;
  deck: number;
  sail: number;
  /** Index into the sail heraldry atlas. */
  emblem: number;
}

export const DEFAULT_LIVERY: ShipLivery = {
  plank: 0x6b4a2c,
  bottom: 0x6d3a2c,
  boot: 0x1b140f,
  wale: 0x33200f,
  bulwark: 0x5c3f26,
  accent: 0xc9a227,
  deck: 0x9a7448,
  sail: 0xd8cdb4,
  emblem: 0,
};

function beamFullnessMult(hullClass: HullClass): number {
  return hullClass === 0 ? 1 : hullClass === 1 ? 1.08 : 1.2;
}

/** Extra deck-edge height layered onto the sheer near the stern for the
 * bigger classes, building a raised aftcastle silhouette — the single most
 * recognisable "galleon" visual cue — instead of every class sharing one
 * sheer curve. Fades to nothing by t=0.3 so it doesn't distort the bow. */
function sternCastleBoost(t: number, hullClass: HullClass): number {
  if (hullClass === 0) return 0;
  const aft = Math.max(0, 1 - t / 0.3);
  const amount = hullClass === 1 ? 0.16 : 0.34;
  return amount * aft * aft;
}

/** Half-beam multiplier along the hull; t=0 at the stern, 1 at the bow.
 * Full amidships, fine entry at the bow, moderately full transom. */
function beamProfile(t: number, hullClass: HullClass = 0): number {
  const peak = 0.42;
  const base =
    t <= peak
      ? 0.62 + 0.38 * Math.sin((t / peak) * Math.PI * 0.5)
      : Math.max(0.03, Math.pow(Math.cos(((t - peak) / (1 - peak)) * Math.PI * 0.5), 0.8));
  return base * beamFullnessMult(hullClass);
}

/** Rail (top of the bulwark) height — the classic sheer curve, lowest
 * amidships, sweeping up toward bow and stern. This single curve is most of
 * what makes a hull read as a ship rather than a box. The bow term is
 * deliberately stronger than the stern term so there's a real prow standing
 * up at the far end of the hull when you're looking at it from behind — a
 * symmetric sheer just reads as a bathtub rim. */
function sheerProfile(t: number, hullClass: HullClass = 0): number {
  const m = (t - 0.45) / 0.55;
  const bowRise = t > 0.55 ? 0.34 * Math.pow((t - 0.55) / 0.45, 2.2) : 0;
  return HULL_FREEBOARD * (1 + 0.5 * m * m + bowRise + sternCastleBoost(t, hullClass));
}

/** Deck surface height — the sheer curve dropped by the bulwark height, so
 * the hull's topsides carry on past the deck instead of stopping at it. */
function deckProfile(t: number, hullClass: HullClass = 0): number {
  return sheerProfile(t, hullClass) - BULWARK_HEIGHT;
}

/** Keel line, with rocker so the bottom rises toward both ends. Rocker was
 * 0.55; softened to 0.42 so the transom stays properly immersed instead of
 * lifting until the stern met the water in a narrow point. */
function keelProfile(t: number): number {
  const m = (t - 0.45) / 0.55;
  return -HULL_DRAFT * Math.max(0.18, 1 - 0.42 * m * m);
}

/** Cross-section fullness: half-beam as a fraction of the station's max, as a
 * function of `v` (0 at the keel, 1 at the rail). The exponent controls where
 * the hull carries its beam. It was 0.5 — a wineglass section that pinched to
 * almost nothing by the time it reached the waterline, so every hull met the
 * sea in a thin V and read like a canoe balanced on the surface rather than a
 * boat displacing it. 0.35 carries the beam much lower: at the transom the
 * waterline half-beam goes from ~40% of the rail's to ~65%, and amidships
 * from 67% to 79%. */
function sectionFullness(v: number): number {
  return Math.pow(v, 0.35);
}

/** Fraction of the way from keel to rail (the lofted hull's `v` parameter) at
 * which the deck meets the hull side, so the deck can be built exactly as
 * wide as the hull is at deck level rather than as wide as it is at the rail. */
function deckV(t: number, hullClass: HullClass): number {
  const keelY = keelProfile(t);
  const sheerY = sheerProfile(t, hullClass);
  return Math.min(1, Math.max(0, (deckProfile(t, hullClass) - keelY) / (sheerY - keelY)));
}

/** Fraction of the way from keel to rail at which the hull crosses the
 * waterline. Varies a lot along the length (0.25 at the stem, 0.46 amidships,
 * 0.31 at the transom) because of the rocker in the keel and the sheer — which
 * is exactly why the boot-top stripe cannot be a straight band. */
function waterV(t: number, hullClass: HullClass): number {
  const keelY = keelProfile(t);
  const sheerY = sheerProfile(t, hullClass);
  return Math.min(1, Math.max(0, -keelY / (sheerY - keelY)));
}

// --- girth sampling -------------------------------------------------------
//
// The hull's cross-section used to be sampled at 16 EVENLY SPACED points from
// rail to rail, and its paint was written into those vertices. That is why the
// boot-top has never been visible: even spacing puts a sample every 0.17 world
// units of hull depth, the boot band is 0.09 tall, so it landed inside a
// single vertex and Gouraud-smeared into a 0.34-unit brown gradient.
//
// The fix is to keep the SAME vertex count and just put the samples where the
// paint is. Each station places its 11 per-side samples on the specific
// features it has to render crisply: a tight pair straddling the waterline for
// the boot-top, a tight pair for the wale, and one just under the deck line so
// the painted bulwark band starts exactly at the deck and not somewhere near
// it. Because waterV/deckV are functions of `t`, the bands automatically
// follow the sheer and the rocker the way real paint does.
const GIRTH_HALF = 13; // samples per side beyond the keel
const GIRTH = GIRTH_HALF * 2;
/** Half-height of the boot-top band, in v (keel→rail) units. */
const BOOT_HALF_V = 0.03;

/** The 14 ascending v values for one side of a station, keel (0) → rail (1). */
function stationVs(t: number, hullClass: HullClass, out: number[]): void {
  const w = waterV(t, hullClass);
  const d = Math.max(w + 0.12, deckV(t, hullClass));
  const mix = (a: number, b: number, f: number) => a + (b - a) * f;
  out[0] = 0;
  out[1] = w * 0.6;
  out[2] = w - BOOT_HALF_V;
  out[3] = w + BOOT_HALF_V;
  out[4] = w + BOOT_HALF_V + 0.045;
  out[5] = mix(w, d, 0.5);
  out[6] = mix(w, d, 0.63);
  out[7] = mix(w, d, 0.73);
  out[8] = d - 0.022;
  out[9] = d + 0.012;
  // Sheer stripe: a tight quadruple so the paint has hard edges top and bottom
  // instead of Gouraud-smearing into a gradient the width of the whole bulwark.
  out[10] = 1 - 0.115;
  out[11] = 1 - 0.095;
  out[12] = 1 - 0.022;
  out[13] = 1;
  // Guarantee strict monotonicity even at the extreme stations, where w and d
  // crowd together and a naive table would fold the section inside out.
  for (let i = 1; i <= GIRTH_HALF; i++) out[i] = Math.min(1, Math.max(out[i], out[i - 1] + 0.003));
}

/** Palette slot for each girth index, keel → rail. */
type Band =
  | 'bottomDeep'
  | 'bottom'
  | 'boot'
  | 'plankWet'
  | 'plank'
  | 'wale'
  | 'plankHigh'
  | 'bulwark'
  | 'accent'
  | 'caprail';
const BAND_BY_INDEX: Band[] = [
  'bottomDeep', // 0  keel
  'bottom', // 1
  'boot', // 2  waterline −
  'boot', // 3  waterline +
  'plankWet', // 4
  'plank', // 5
  'wale', // 6
  'wale', // 7
  'plankHigh', // 8  just under the deck line
  'bulwark', // 9  painted topsides begin
  'bulwark', // 10
  'accent', // 11 sheer stripe −
  'accent', // 12 sheer stripe +
  'caprail', // 13 rail
];

/** Smooth per-hull grime so a fleet isn't a dozen identical paint jobs. Two
 * octaves of value noise along the hull's length, seeded per ship. */
function weathering(t: number, seed: number): number {
  const h = (i: number) => {
    const s = Math.sin((i + seed * 0.618) * 127.1) * 43758.5453;
    return s - Math.floor(s);
  };
  const oct = (freq: number, off: number) => {
    const x = t * freq + off;
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    return h(i + off) * (1 - u) + h(i + 1 + off) * u;
  };
  return 0.86 + 0.22 * (oct(4.5, 0) * 0.62 + oct(11, 31) * 0.38);
}

/** A lofted hull: cross-section "stations" swept from stern to bow, each a
 * rounded-bilge curve running keel → deck edge. Replaces a tapered
 * BoxGeometry, which read as a wedge no matter how well it was shaded.
 *
 * The material is now WHITE with `vertexColors`, i.e. the paint scheme lives
 * entirely in the mesh. That's what buys the boot-top, the wale and the
 * per-ship accent band for zero extra draw calls and zero extra textures. */
function buildLoftedHullGeometry(
  scale: number,
  hullClass: HullClass,
  livery: ShipLivery,
  seed: number,
): THREE.BufferGeometry {
  const STATIONS = 32;
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const pal: Record<Band, THREE.Color> = {
    bottomDeep: new THREE.Color(livery.bottom).multiplyScalar(0.72),
    bottom: new THREE.Color(livery.bottom),
    boot: new THREE.Color(livery.boot),
    plankWet: new THREE.Color(livery.plank).multiplyScalar(0.8),
    plank: new THREE.Color(livery.plank),
    wale: new THREE.Color(livery.wale),
    plankHigh: new THREE.Color(livery.plank).multiplyScalar(1.1),
    bulwark: new THREE.Color(livery.bulwark),
    accent: new THREE.Color(livery.accent),
    // A dark cap above the bright stripe. Capping it is what stops the stripe
    // bleeding into the sky along the sheer and reading as a glow.
    caprail: new THREE.Color(livery.wale).multiplyScalar(0.9),
  };

  const vs: number[] = new Array(GIRTH_HALF + 1).fill(0);

  for (let i = 0; i <= STATIONS; i++) {
    const t = i / STATIONS;
    const z = (t - 0.5) * 2 * HULL_HALF_LENGTH * scale;
    const beam = beamProfile(t, hullClass) * HULL_MAX_BEAM * scale;
    const keelY = keelProfile(t) * scale;
    const sheerY = sheerProfile(t, hullClass) * scale;
    stationVs(t, hullClass, vs);
    // Grime is strongest low on the hull (splash and weed) and near the ends.
    const w = weathering(t, seed);

    for (let j = 0; j <= GIRTH; j++) {
      const side = j < GIRTH_HALF ? -1 : 1;
      const k = j < GIRTH_HALF ? GIRTH_HALF - j : j - GIRTH_HALF;
      const v = vs[k];
      const x = side * beam * sectionFullness(v);
      const y = keelY + (sheerY - keelY) * v;
      positions.push(x, y, z);
      uvs.push(j / GIRTH, t);
      const c = pal[BAND_BY_INDEX[k]];
      // Painted surfaces weather less than bare planking, so the sheer stripe
      // stays legible on a filthy hull instead of going the same grey.
      const wm = k >= 11 ? 1 - (1 - w) * 0.3 : w;
      colors.push(c.r * wm, c.g * wm, c.b * wm);
    }
  }

  for (let i = 0; i < STATIONS; i++) {
    for (let j = 0; j < GIRTH; j++) {
      const a = i * (GIRTH + 1) + j;
      const b = a + GIRTH + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }

  // Transom: fan the open stern section closed from its centroid.
  //
  // BUG FIX (kept): the fan used to cover only the U-shaped station ring and
  // stopped at the two spokes running out to each rail, leaving an open wedge
  // right on the centreline that you could see the sea through from dead
  // astern. Fanning the rail-to-rail closing edge as well closes it.
  const sternKeel = keelProfile(0) * scale;
  const sternSheer = sheerProfile(0, hullClass) * scale;
  const sternZ = -HULL_HALF_LENGTH * scale;
  const centroidIndex = positions.length / 3;
  const centroidY = (sternKeel + sternSheer) * 0.5;
  positions.push(0, centroidY, sternZ);
  uvs.push(0.5, 0);
  colors.push(pal.plank.r * 0.7, pal.plank.g * 0.7, pal.plank.b * 0.7);
  for (let j = 0; j < GIRTH; j++) indices.push(centroidIndex, j + 1, j);
  indices.push(centroidIndex, 0, GIRTH);

  // Same closure at the stem. beamProfile(1) floors at 0.03 rather than 0, so
  // the bow station is a narrow-but-open sliver; without this you can see into
  // the hull along a hairline at the prow.
  const bowIndex = positions.length / 3;
  const bowY = (keelProfile(1) + sheerProfile(1, hullClass)) * 0.5 * scale;
  positions.push(0, bowY, HULL_HALF_LENGTH * scale);
  uvs.push(0.5, 1);
  colors.push(pal.plank.r * 0.8, pal.plank.g * 0.8, pal.plank.b * 0.8);
  const bowRing = STATIONS * (GIRTH + 1);
  for (let j = 0; j < GIRTH; j++) indices.push(bowIndex, bowRing + j, bowRing + j + 1);
  indices.push(bowIndex, bowRing + GIRTH, bowRing);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** The deck surface closing the top of the hull, cambered so it crowns along
 * the centreline instead of reading as a flat lid. */
function buildDeckGeometry(scale: number, hullClass: HullClass): THREE.BufferGeometry {
  const STATIONS = 24;
  const SPAN = 8;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= STATIONS; i++) {
    const t = i / STATIONS;
    const z = (t - 0.5) * 2 * HULL_HALF_LENGTH * scale;
    // The deck sits BULWARK_HEIGHT below the rail and the topsides flare
    // outward, so the deck is narrower than the rail line — build it to the
    // hull's actual half-beam at deck level or it pokes through the sides.
    const beam = beamProfile(t, hullClass) * HULL_MAX_BEAM * scale * sectionFullness(deckV(t, hullClass));
    const deckY = deckProfile(t, hullClass) * scale;
    for (let j = 0; j <= SPAN; j++) {
      const u = j / SPAN;
      const s = u * 2 - 1;
      positions.push(s * beam, deckY + DECK_CAMBER * scale * (1 - s * s), z);
      uvs.push(u * 1.4, t * 4);
    }
  }
  for (let i = 0; i < STATIONS; i++) {
    for (let j = 0; j < SPAN; j++) {
      const a = i * (SPAN + 1) + j;
      const b = a + SPAN + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** A flat collar of foam hugging the hull exactly at the waterline (hull-local
 * y = 0, which is the waterline by construction), fading out a short way
 * outboard, widening into a bow wave forward.
 *
 * This is the single strongest "floating" cue and the game had none of it.
 * One extra transparent draw call per ship over a very small screen area;
 * depthWrite is off so it can't punch a hole in anything behind it. */
function buildFoamCollar(scale: number, hullClass: HullClass): THREE.Mesh {
  const STATIONS = 36;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const waterlineHalfBeam = (t: number) =>
    beamProfile(t, hullClass) * HULL_MAX_BEAM * scale * sectionFullness(waterV(t, hullClass));

  // Closed loop around the waterline: starboard stern→bow, then port bow→stern.
  // A closed ring rather than two parallel side strips specifically so the foam
  // wraps ACROSS THE TRANSOM — dead astern is exactly where the chase camera
  // sits, and side-only strips are self-occluded by the ship's own stern from
  // that angle, which is the one view that has to look right.
  const loop: { x: number; z: number; t: number }[] = [];
  for (let i = 0; i <= STATIONS; i++) {
    const t = i / STATIONS;
    loop.push({ x: waterlineHalfBeam(t), z: (t - 0.5) * 2 * HULL_HALF_LENGTH * scale, t });
  }
  for (let i = STATIONS; i >= 0; i--) {
    const t = i / STATIONS;
    loop.push({ x: -waterlineHalfBeam(t), z: (t - 0.5) * 2 * HULL_HALF_LENGTH * scale, t });
  }

  const N = loop.length;
  for (let k = 0; k < N; k++) {
    const prev = loop[(k - 1 + N) % N];
    const next = loop[(k + 1) % N];
    let nx = next.z - prev.z;
    let nz = -(next.x - prev.x);
    const len = Math.hypot(nx, nz) || 1;
    nx /= len;
    nz /= len;
    if (nx * loop[k].x + nz * loop[k].z < 0) {
      nx = -nx;
      nz = -nz;
    }
    const t = loop[k].t;
    const spread =
      (0.22 + 0.34 * Math.pow(Math.max(0, t - 0.5) / 0.5, 1.6) + 0.3 * Math.max(0, 1 - t / 0.2)) * scale;

    positions.push(loop[k].x, 0.015 * scale, loop[k].z);
    colors.push(1, 1, 1, 0.7);
    positions.push(loop[k].x + nx * spread, 0.015 * scale, loop[k].z + nz * spread);
    colors.push(1, 1, 1, 0);
  }

  for (let k = 0; k < N; k++) {
    const a = k * 2;
    const b = ((k + 1) % N) * 2;
    indices.push(a, a + 1, b, b, a + 1, b + 1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geo.setIndex(indices);

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: 0xdff2fb,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
      // Three renders transparent + DoubleSide as TWO draw calls by default to
      // fix self-overlap sorting; this is a thin flat ring with depthWrite off,
      // so there is no self-sorting artifact for the split to prevent.
      forceSinglePass: true,
    }),
  );
  mesh.name = 'foam';
  mesh.renderOrder = 1;
  return mesh;
}

// --- sails ----------------------------------------------------------------

/** Rewrites a geometry's uvs into a sub-rectangle of the sail atlas. */
function remapUV(geo: THREE.BufferGeometry, u0: number, u1: number, v0: number, v1: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + (u1 - u0) * uv.getX(i), v0 + (v1 - v0) * uv.getY(i));
  }
  uv.needsUpdate = true;
}

/** A square sail with an actual belly in it — a flat plane reads as cardboard.
 * The belly is asymmetric (fullest at a third of the way up, and the leech
 * curls further than the luff) because a symmetric pillow reads as a balloon. */
function billowedSailGeometry(width: number, height: number, bulge: number, segs = 10): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(width, height, segs, segs);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / width + 0.5;
    const v = pos.getY(i) / height + 0.5;
    const across = Math.sin(u * Math.PI);
    // Draft aft: fullest at ~35% of the hoist, tapering to the head where the
    // yard holds it flat and to the foot where the sheets pull it out.
    const up = Math.pow(Math.sin(v * Math.PI), 0.8) * (0.72 + 0.5 * Math.exp(-Math.pow((v - 0.38) / 0.34, 2)));
    pos.setZ(i, across * up * bulge);
    // Scallop the foot between the clews, the way loose-footed canvas hangs.
    if (v < 0.06) pos.setY(i, pos.getY(i) + Math.sin(u * Math.PI) * height * 0.055);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** A triangular sail (the jib), since PlaneGeometry can't make that shape.
 *
 * Subdivided barycentrically and bellied out along its own normal. The first
 * version was a three-triangle fan from a displaced centroid, which put a hard
 * crease straight down the middle of the sail and read as folded card — you
 * cannot get a smooth curve out of three flat facets. */
function triangleSailGeometry(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): THREE.BufferGeometry {
  const N = 5;
  const normal = new THREE.Vector3()
    .subVectors(b, a)
    .cross(new THREE.Vector3().subVectors(c, a))
    .normalize();
  const belly = (a.distanceTo(b) + b.distanceTo(c)) * 0.055;

  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const tmp = new THREE.Vector3();
  // Rows i = 0…N: row i holds i+1 points along the edge from a→b lerped to a→c.
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= i; j++) {
      const wb = i === 0 ? 0 : (i - j) / N;
      const wc = i === 0 ? 0 : j / N;
      const wa = 1 - wb - wc;
      tmp.set(0, 0, 0).addScaledVector(a, wa).addScaledVector(b, wb).addScaledVector(c, wc);
      // Peaks at the centroid, zero on every edge — a proper sail belly.
      tmp.addScaledVector(normal, 27 * wa * wb * wc * belly);
      pos.push(tmp.x, tmp.y, tmp.z);
      uv.push(0.5 + (wc - wb) * 0.5, 1 - i / N);
    }
  }
  let row = 0;
  for (let i = 0; i < N; i++) {
    const next = row + i + 1;
    for (let j = 0; j <= i; j++) {
      idx.push(row + j, next + j, next + j + 1);
      if (j < i) idx.push(row + j, next + j + 1, row + j + 1);
    }
    row = next;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// --- small rig parts ------------------------------------------------------

const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3(1, 1, 1);

/** Matrix that stretches a unit-height Y-up cylinder between two points. */
function betweenMatrix(from: THREE.Vector3, to: THREE.Vector3, out: THREE.Matrix4): number {
  _dir.subVectors(to, from);
  const len = _dir.length() || 1e-4;
  _mid.copy(from).addScaledVector(_dir, 0.5);
  _q.setFromUnitVectors(_up, _dir.normalize());
  out.compose(_mid, _q, _s.set(1, len, 1));
  return len;
}

/** A rope/spar run between two points, appended to the rig. The cylinder is
 * built one unit tall and scaled, so every rope shares one source geometry. */
const ROPE_GEO = new THREE.CylinderGeometry(1, 1, 1, 4, 1, true);
function addLine(rig: GeoBuilder, from: THREE.Vector3, to: THREE.Vector3, radius: number, color: THREE.Color) {
  betweenMatrix(from, to, _m);
  const scaled = _m.clone().multiply(new THREE.Matrix4().makeScale(radius, 1, radius));
  rig.add(ROPE_GEO, scaled, color);
}

function place(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  return new THREE.Matrix4()
    .compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(sx, sy, sz),
    );
}

// Shared source geometries — every ship reuses these, they're only ever read.
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL8 = new THREE.CylinderGeometry(1, 1, 1, 8);
const CYL10 = new THREE.CylinderGeometry(1, 1, 1, 10);
const CYL6 = new THREE.CylinderGeometry(1, 1, 1, 6);
const TORUS = new THREE.TorusGeometry(1, 0.16, 5, 10);

/**
 * Everything on a ship that isn't the hull, the sails or the waterline foam,
 * baked into ONE geometry.
 *
 * This is the change that made the rest of this pass affordable. A ship used
 * to be ~18 separate meshes (deck, mast, yard, two rails, four stays, a
 * quarterdeck box, a bowsprit, one mesh per cannon barrel…), i.e. ~18 draw
 * calls in the main pass and ~15 more in the shadow pass, times every ship on
 * screen — 144 of the scene's 225 draw calls in a seven-ship fight. Merging
 * them takes a ship to four meshes total and freed the budget to add the
 * detail below (taffrail, stern board and windows, lantern, wheel, capstan,
 * ratlines, anchor, gunport lids, crow's nest, pennant), all of which are now
 * free of draw-call cost.
 */
function buildRigGeometry(
  scale: number,
  hullClass: HullClass,
  masts: 1 | 2,
  loadout: CannonLoadout,
  livery: ShipLivery,
  seed: number,
): THREE.BufferGeometry {
  const rig = new GeoBuilder();
  const S = scale;

  const cDeck = new THREE.Color(livery.deck);
  const cSpar = new THREE.Color(livery.plank).multiplyScalar(0.85).lerp(new THREE.Color(0x6b4a2a), 0.5);
  const cRope = new THREE.Color(0x39301f);
  const cAccent = new THREE.Color(livery.accent);
  const cAccentDim = cAccent.clone().multiplyScalar(0.72);
  /** Dark trim — caprail, stanchions. The accent is a stripe, not a coating. */
  const cTrim = new THREE.Color(livery.wale).multiplyScalar(0.9);
  const cIron = new THREE.Color(0x2a2724);
  const cDark = new THREE.Color(livery.wale).multiplyScalar(0.75);
  const cGlass = new THREE.Color(0x8ea9b6);
  const cBrass = new THREE.Color(0xd9b25a);

  const V = (x: number, y: number, z: number) => new THREE.Vector3(x * S, y * S, z * S);
  const sheerAt = (t: number) => sheerProfile(t, hullClass) * S;
  const deckAt = (t: number) => deckProfile(t, hullClass) * S;
  const beamAt = (t: number) => beamProfile(t, hullClass) * HULL_MAX_BEAM * S;

  // --- deck -----------------------------------------------------------------
  const deckGeo = buildDeckGeometry(S, hullClass);
  rig.add(deckGeo, new THREE.Matrix4(), cDeck);
  deckGeo.dispose();

  // --- caprail, swept along the actual sheer curve, closed at both ends -----
  // The rails used to be two open tubes that simply stopped at the stern, so
  // from the chase camera (which looks straight up the ship's arse) the rail
  // just ended in mid-air. They now run as one continuous loop round the whole
  // sheer, which is also what carries the accent colour along the ship's one
  // strong line.
  {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 22; i++) {
      const t = i / 22;
      pts.push(V(beamAt(t) / S, sheerAt(t) / S + 0.05, (t - 0.5) * 2 * HULL_HALF_LENGTH));
    }
    for (let i = 22; i >= 0; i--) {
      const t = i / 22;
      pts.push(V(-beamAt(t) / S, sheerAt(t) / S + 0.05, (t - 0.5) * 2 * HULL_HALF_LENGTH));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true);
    const tube = new THREE.TubeGeometry(curve, 52, 0.052 * S, 4, true);
    rig.add(tube, new THREE.Matrix4(), cTrim);
    tube.dispose();
  }

  // --- quarterdeck + stepped sterncastle ------------------------------------
  // Each tier is built EMBED deeper than its nominal footing and stacked from
  // there, guaranteeing overlap with solid geometry instead of a visible gap
  // against the hull's raked, curved stern.
  const EMBED = 0.12 * S;
  const qdTop = sheerAt(0.15) + 0.3 * S;
  const qdH = (0.3 + BULWARK_HEIGHT) * S + EMBED;
  const qdW = 0.86 * S * beamFullnessMult(hullClass);
  rig.add(BOX, place(0, qdTop - qdH / 2, -1.3 * S, 0, 0, 0, qdW, qdH, 1.0 * S), cDeck.clone().multiplyScalar(0.9));

  let castleTop = qdTop;
  if (hullClass >= 1) {
    const th = (hullClass === 1 ? 0.35 : 0.55) * S;
    const tw = 0.75 * S * (hullClass === 1 ? 1 : 1.08);
    castleTop = qdTop + th;
    rig.add(BOX, place(0, castleTop - (th + EMBED) / 2, -1.5 * S, 0, 0, 0, tw, th + EMBED, 0.85 * S), cDeck);
    if (hullClass === 2) {
      const tth = 0.28 * S;
      rig.add(BOX, place(0, castleTop + tth / 2 - EMBED / 2, -1.6 * S, 0, 0, 0, 0.5 * S, tth + EMBED, 0.55 * S), cDeck);
      castleTop += tth;
    }
  }

  // --- stern board + great-cabin windows ------------------------------------
  // Dead astern is where the chase camera lives, so the transom is the single
  // most-looked-at surface in the game and it was a blank brown panel. A board
  // proud of the transom carrying the accent colour and three lit windows
  // gives the ship a face.
  {
    const sternZ = -HULL_HALF_LENGTH * S - 0.02 * S;
    const beam0 = beamAt(0);
    const keel0 = keelProfile(0) * S;
    const sheer0 = sheerAt(0);
    const yAt = (v: number) => keel0 + (sheer0 - keel0) * v;
    const xAt = (v: number) => beam0 * sectionFullness(v) * 0.97;
    // The transom is the surface the chase camera stares at all session, so
    // the accent gets a real band here (v 0.80 → the rail) rather than the
    // sliver it had at first, which the caprail then hid completely.
    const vs = [0.42, 0.6, 0.78, 0.8, 1.0];
    const cols = [cDark, cDark, cDark, cAccent, cAccent];
    const tri: number[] = [];
    for (let i = 0; i < vs.length - 1; i++) {
      const y0 = yAt(vs[i]);
      const y1 = yAt(vs[i + 1]);
      const x0 = xAt(vs[i]);
      const x1 = xAt(vs[i + 1]);
      // Two triangles, wound so the outward normal points aft (-Z).
      tri.length = 0;
      tri.push(-x0, y0, sternZ, x0, y0, sternZ, x1, y1, sternZ);
      tri.push(-x0, y0, sternZ, x1, y1, sternZ, -x1, y1, sternZ);
      rig.addTriangles(tri, cols[i]);
    }
    // Great-cabin windows. Mullioned into a 2x2 of small panes each: three
    // plain bright rectangles read as a robot's face, and at chase distance
    // the mullions are what say "window" rather than "light".
    const wy = yAt(0.655);
    for (const wx of [-0.25, 0, 0.25]) {
      rig.add(BOX, place(wx * S, wy, sternZ - 0.008 * S, 0, 0, 0, 0.23 * S, 0.25 * S, 0.02 * S), cTrim);
      for (const px of [-0.055, 0.055])
        for (const py of [-0.055, 0.055]) {
          rig.add(
            BOX,
            place((wx + px) * S, wy + py * S, sternZ - 0.022 * S, 0, 0, 0, 0.078 * S, 0.078 * S, 0.02 * S),
            cGlass,
          );
        }
    }
  }

  // --- taffrail + stern lantern --------------------------------------------
  {
    const railY = castleTop + 0.2 * S;
    const railZ = (hullClass >= 1 ? -1.85 : -1.7) * S;
    const halfW = (hullClass >= 1 ? 0.36 : 0.42) * S;
    rig.add(CYL6, place(0, railY, railZ, 0, 0, Math.PI / 2, 0.035 * S, halfW * 2, 0.035 * S), cAccent);
    for (const sx of [-1, -0.33, 0.33, 1]) {
      rig.add(CYL6, place(sx * halfW, railY - 0.1 * S, railZ, 0, 0, 0, 0.024 * S, 0.2 * S, 0.024 * S), cTrim);
    }
    // Lantern: an octagonal cage with a warm pane and a brass cap, standing
    // right on the centreline of the chase view.
    const ly = railY + 0.26 * S;
    rig.add(CYL8, place(0, railY + 0.08 * S, railZ, 0, 0, 0, 0.03 * S, 0.16 * S, 0.03 * S), cIron);
    rig.add(CYL8, place(0, ly, railZ, 0, Math.PI / 8, 0, 0.09 * S, 0.18 * S, 0.09 * S), new THREE.Color(0xffd07a));
    rig.add(CYL8, place(0, ly + 0.11 * S, railZ, 0, Math.PI / 8, 0, 0.11 * S, 0.05 * S, 0.11 * S), cBrass);
    rig.add(CYL8, place(0, ly - 0.1 * S, railZ, 0, Math.PI / 8, 0, 0.1 * S, 0.04 * S, 0.1 * S), cBrass);
  }

  // --- ship's wheel ---------------------------------------------------------
  {
    const wy = qdTop + 0.22 * S;
    const wz = -0.92 * S;
    rig.add(BOX, place(0, qdTop + 0.06 * S, wz, 0, 0, 0, 0.26 * S, 0.12 * S, 0.14 * S), cSpar);
    rig.add(TORUS, place(0, wy, wz, 0, Math.PI / 2, 0, 0.19 * S, 0.19 * S, 0.19 * S), cSpar);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 4;
      rig.add(
        CYL6,
        place(0, wy, wz, Math.PI / 2, 0, a, 0.018 * S, 0.44 * S, 0.018 * S),
        cSpar.clone().multiplyScalar(1.1),
      );
    }
  }

  // --- rudder head + tiller -------------------------------------------------
  // The blade itself lives under an opaque ocean, so what's modelled is the
  // part you can actually see: the stock coming up through the counter.
  {
    const rz = -HULL_HALF_LENGTH * S + 0.04 * S;
    rig.add(BOX, place(0, sheerAt(0) - 0.24 * S, rz - 0.06 * S, 0, 0, 0, 0.09 * S, 0.5 * S, 0.16 * S), cDark);
  }

  // --- deck furniture -------------------------------------------------------
  {
    const dz = 0.15;
    const dY = deckAt(0.5 + dz / 4) + 0.02 * S;
    // Grating hatch.
    rig.add(BOX, place(0, dY + 0.04 * S, 0.15 * S, 0, 0, 0, 0.42 * S, 0.07 * S, 0.5 * S), cDark);
    rig.add(BOX, place(0, dY + 0.07 * S, 0.15 * S, 0, 0, 0, 0.34 * S, 0.03 * S, 0.42 * S), cSpar);
    // Capstan.
    rig.add(CYL8, place(0, deckAt(0.32) + 0.11 * S, -0.85 * S, 0, 0, 0, 0.12 * S, 0.22 * S, 0.12 * S), cSpar);
    rig.add(CYL8, place(0, deckAt(0.32) + 0.23 * S, -0.85 * S, 0, 0, 0, 0.16 * S, 0.04 * S, 0.16 * S), cAccentDim);
    // A couple of lashed barrels — a working ship, not a showroom model.
    for (const [bx, bz] of [
      [0.34, 0.72],
      [-0.36, 0.55],
    ]) {
      const t = bz / (2 * HULL_HALF_LENGTH) + 0.5;
      rig.add(CYL8, place(bx * S, deckAt(t) + 0.13 * S, bz * S, 0, 0, 0, 0.13 * S, 0.26 * S, 0.13 * S), cSpar);
      rig.add(
        CYL8,
        place(bx * S, deckAt(t) + 0.13 * S, bz * S, 0, 0, 0, 0.14 * S, 0.06 * S, 0.14 * S),
        cIron.clone().lerp(cSpar, 0.3),
      );
    }
  }

  // --- masts, tops, yards ---------------------------------------------------
  const mastZ = -0.2;
  const mastTopY = 4.55;
  const mainYardY = 2.95;
  const topYardY = 4.2;
  const topY = 3.12; // crow's nest platform

  rig.add(
    CYL10,
    place(0, ((deckAt(0.45) / S) * 1 + mastTopY) / 2 * S, mastZ * S, 0, 0, 0, 0.075 * S, (mastTopY - deckAt(0.45) / S) * S, 0.075 * S),
    cSpar,
  );
  // Main yard, with a slight droop at the ends (a yard is not a broom handle).
  rig.add(CYL8, place(0, mainYardY * S, mastZ * S, 0, 0, Math.PI / 2, 0.038 * S, 1.9 * S, 0.038 * S), cSpar);
  rig.add(CYL8, place(0, topYardY * S, mastZ * S, 0, 0, Math.PI / 2, 0.028 * S, 1.35 * S, 0.028 * S), cSpar);
  // Crow's nest: the classic silhouette read, and it breaks the mast's
  // dead-straight line at exactly the height the eye lands on.
  rig.add(CYL10, place(0, topY * S, mastZ * S, 0, 0, 0, 0.3 * S, 0.045 * S, 0.3 * S), cSpar);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    rig.add(
      CYL6,
      place(Math.cos(a) * 0.28 * S, (topY + 0.08) * S, mastZ * S + Math.sin(a) * 0.28 * S, 0, 0, 0, 0.016 * S, 0.16 * S, 0.016 * S),
      cRope,
    );
  }
  rig.add(TORUS, place(0, (topY + 0.15) * S, mastZ * S, Math.PI / 2, 0, 0, 0.29 * S, 0.29 * S, 0.29 * S), cRope);
  // Masthead truck + pennant staff.
  rig.add(CYL6, place(0, (mastTopY + 0.06) * S, mastZ * S, 0, 0, 0, 0.05 * S, 0.06 * S, 0.05 * S), cAccentDim);

  // --- shrouds + ratlines ---------------------------------------------------
  // Rope radii are deliberately a touch fatter than scale realism: at chase
  // distance a physically-correct 3cm line is a third of a pixel wide and
  // shimmers into noise, which is the classic "turns to mush on a phone".
  const mastHead = V(0, topY - 0.02, mastZ);
  for (const side of [1, -1]) {
    const anchors: THREE.Vector3[] = [];
    for (const t of [0.24, 0.31, 0.38]) {
      anchors.push(V((side * beamAt(t)) / S, sheerAt(t) / S - 0.02, (t - 0.5) * 2 * HULL_HALF_LENGTH));
    }
    for (const a of anchors) addLine(rig, mastHead, a, 0.019 * S, cRope);
    // Ratlines between the outermost pair of shrouds.
    for (let r = 1; r <= 4; r++) {
      const f = r / 5.2;
      const p0 = new THREE.Vector3().lerpVectors(anchors[0], mastHead, f);
      const p1 = new THREE.Vector3().lerpVectors(anchors[2], mastHead, f);
      addLine(rig, p0, p1, 0.014 * S, cRope);
    }
  }

  // --- foremast (bigger classes) -------------------------------------------
  const foreZ = 1.05;
  if (masts === 2) {
    const fBase = deckAt(0.76) / S;
    const fTop = 3.35;
    rig.add(CYL8, place(0, ((fBase + fTop) / 2) * S, foreZ * S, 0, 0, 0, 0.062 * S, (fTop - fBase) * S, 0.062 * S), cSpar);
    rig.add(CYL8, place(0, 2.65 * S, foreZ * S, 0, 0, Math.PI / 2, 0.03 * S, 1.4 * S, 0.03 * S), cSpar);
    rig.add(CYL6, place(0, (fTop + 0.05) * S, foreZ * S, 0, 0, 0, 0.04 * S, 0.06 * S, 0.04 * S), cAccentDim);
    for (const side of [1, -1]) {
      const t = 0.68;
      addLine(
        rig,
        V(0, fTop - 0.15, foreZ),
        V((side * beamAt(t)) / S, sheerAt(t) / S - 0.02, (t - 0.5) * 2 * HULL_HALF_LENGTH),
        0.017 * S,
        cRope,
      );
    }
  }

  // --- bowsprit, anchor, stays ----------------------------------------------
  const stemHeadY = sheerAt(0.95) / S;
  const bowTip = V(0, stemHeadY + 0.42, 3.15);
  addLine(rig, V(0, stemHeadY, 1.8), bowTip, 0.075 * S, cSpar);

  // Anchor catted on the starboard bow.
  {
    const ax = 0.62;
    const ay = stemHeadY - 0.34;
    const az = 1.42;
    rig.add(CYL6, place(ax * S, ay * S, az * S, 0, 0, 0.25, 0.028 * S, 0.62 * S, 0.028 * S), cIron);
    rig.add(CYL6, place((ax + 0.08) * S, (ay + 0.24) * S, az * S, Math.PI / 2, 0, 0, 0.02 * S, 0.34 * S, 0.02 * S), cIron);
    for (const s2 of [-1, 1]) {
      rig.add(
        BOX,
        place((ax - 0.07) * S, (ay - 0.3) * S, (az + s2 * 0.1) * S, 0, s2 * 0.5, 0.4, 0.05 * S, 0.18 * S, 0.1 * S),
        cIron,
      );
    }
  }

  addLine(rig, V(0, mastTopY - 0.1, mastZ), bowTip, 0.016 * S, cRope);
  addLine(rig, V(0, mastTopY - 0.1, mastZ), V(0, topY + 0.16, mastZ), 0.014 * S, cRope);
  addLine(rig, V(0, mastTopY - 0.12, mastZ), V(0, castleTop / S, -1.78), 0.016 * S, cRope);
  // Yard lifts — the lines that hold the yardarms up. Cheap, and they stop the
  // yards reading as free-floating sticks.
  for (const side of [1, -1]) {
    addLine(rig, V(0, mastTopY - 0.1, mastZ), V(side * 0.92, mainYardY, mastZ), 0.012 * S, cRope);
    addLine(rig, V(0, mastTopY - 0.02, mastZ), V(side * 0.65, topYardY, mastZ), 0.011 * S, cRope);
  }

  // --- pennant at the masthead ---------------------------------------------
  // A real streaming ribbon in the ship's own colour rather than a 4-sided
  // cone. Emitted with both windings so it survives being seen from either
  // side without needing a double-sided material for the whole rig.
  {
    const N = 8;
    const tri: number[] = [];
    const pt = (u: number, top: boolean) => {
      const flap = Math.sin(u * 6.2 + seed) * 0.1 * u;
      const w = (0.17 - 0.14 * u) * (top ? 1 : -1);
      return [
        flap * S,
        (mastTopY + 0.24 + w - u * 0.06) * S,
        (mastZ - 0.06 - u * 0.9) * S,
      ] as [number, number, number];
    };
    for (let i = 0; i < N; i++) {
      const u0 = i / N;
      const u1 = (i + 1) / N;
      const a = pt(u0, true);
      const b = pt(u0, false);
      const c = pt(u1, true);
      const d = pt(u1, false);
      tri.push(...a, ...b, ...c, ...c, ...b, ...d);
      tri.push(...c, ...b, ...a, ...d, ...b, ...c);
    }
    rig.addTriangles(tri, cAccent);
  }
  rig.add(CYL6, place(0, (mastTopY + 0.24) * S, (mastZ - 0.06) * S, 0, 0, 0, 0.014 * S, 0.42 * S, 0.014 * S), cIron);

  // --- cannons + gunports ---------------------------------------------------
  (['front', 'left', 'right'] as CannonSide[]).forEach((side) => {
    for (const offset of cannonMountOffsets(side, loadout[side], S)) {
      // Run out through the bulwark at each gun's own station rather than all
      // at one flat height — with the sheer sweeping up toward the ends, a
      // constant Y put the forward guns below the deck and the waist guns
      // above the rail.
      const t = offset.z / (2 * HULL_HALF_LENGTH * S) + 0.5;
      const mountY = deckAt(t) + 0.14 * S;
      if (side === 'front') {
        rig.add(CYL8, place(offset.x, mountY, offset.z + 0.3 * S, Math.PI / 2, 0, 0, 0.08 * S, 0.55 * S, 0.08 * S), cIron);
        rig.add(BOX, place(offset.x, mountY, offset.z + 0.05 * S, 0, 0, 0, 0.24 * S, 0.24 * S, 0.04 * S), cDark);
      } else {
        const sx = side === 'left' ? -1 : 1;
        rig.add(
          CYL8,
          place(offset.x + sx * 0.25 * S, mountY, offset.z, 0, 0, Math.PI / 2, 0.08 * S, 0.55 * S, 0.08 * S),
          cIron,
        );
        // Gunport: a dark recess behind the muzzle plus its lid propped open
        // above it — this is what makes a broadside read as gunports rather
        // than as pipes glued to a plank.
        rig.add(BOX, place(offset.x + sx * 0.02 * S, mountY, offset.z, 0, 0, 0, 0.04 * S, 0.26 * S, 0.28 * S), cDark);
        rig.add(
          BOX,
          place(offset.x + sx * 0.13 * S, mountY + 0.24 * S, offset.z, 0.55, 0, 0, 0.035 * S, 0.24 * S, 0.3 * S),
          cAccentDim,
        );
      }
    }
  });

  const geo = rig.build();
  geo.computeBoundingSphere();
  return geo;
}

/** Every sail on the ship, in one geometry sharing one atlas. */
function buildSailsGeometry(scale: number, hullClass: HullClass, masts: 1 | 2): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const S = scale;
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x * S, y * S, z * S);

  // Sails carry a subtle vertical gradient: darker at the foot where the hull
  // and the sail below shade it, brighter at the head. Free form-reading.
  const shade = (top: number) => (local: THREE.Vector3) => {
    const f = THREE.MathUtils.clamp(local.y / (top * S) + 0.5, 0, 1);
    const k = 0.78 + 0.28 * f;
    return new THREE.Color(k, k, k);
  };

  const MAIN_V: [number, number] = [0.015, 0.685];
  const PLAIN_V: [number, number] = [0.735, 0.985];

  // Mainsail — the one that carries the heraldry.
  {
    const g = billowedSailGeometry(1.62 * S, 1.9 * S, 0.34 * S, 10);
    remapUV(g, 0.03, 0.97, MAIN_V[0], MAIN_V[1]);
    b.add(g, place(0, 2.0 * S, -0.19 * S), shade(1.9));
    g.dispose();
  }
  // Topsail — the second tier that turns a dinghy silhouette into a ship's.
  {
    const g = billowedSailGeometry(1.22 * S, 0.94 * S, 0.2 * S, 6);
    remapUV(g, 0.06, 0.94, PLAIN_V[0], PLAIN_V[1]);
    b.add(g, place(0, 3.72 * S, -0.19 * S), shade(0.94));
    g.dispose();
  }
  if (masts === 2) {
    const g = billowedSailGeometry(1.28 * S, 1.5 * S, 0.24 * S, 8);
    remapUV(g, 0.06, 0.94, PLAIN_V[0], PLAIN_V[1]);
    b.add(g, place(0, 1.88 * S, 1.06 * S), shade(1.5));
    g.dispose();
  }
  // Jib.
  {
    const stemHeadY = sheerProfile(0.95, hullClass);
    const g = triangleSailGeometry(
      V(0, stemHeadY + 0.4, 3.0),
      V(0, deckProfile(0.55, hullClass) + 0.28, 0.6),
      V(0, 2.38, -0.14),
    );
    remapUV(g, 0.08, 0.92, PLAIN_V[0], PLAIN_V[1]);
    b.add(g, new THREE.Matrix4(), new THREE.Color(0.94, 0.94, 0.94));
    g.dispose();
  }

  const geo = b.build();
  geo.computeBoundingSphere();
  return geo;
}

function disposeMesh(mesh: THREE.Mesh) {
  mesh.geometry.dispose();
  if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
  else mesh.material.dispose();
}

const SINK_DURATION = 2.2;

export class Ship {
  readonly group: THREE.Group;
  readonly scale: number;

  position = new THREE.Vector3();
  heading = 0; // radians, 0 = facing -Z
  speed = 0;
  health: number;
  maxHealth: number;
  alive = true;

  stats: ShipStats;
  loadout: CannonLoadout;

  private sailsMesh: THREE.Mesh;
  private rigMesh: THREE.Mesh;
  private hullMat: THREE.MeshStandardMaterial;
  private sailMat: THREE.MeshStandardMaterial;
  private foamMat: THREE.MeshBasicMaterial;

  private bobPhase = Math.random() * Math.PI * 2;
  private hitFlash = 0;
  private sinking = false;
  private sinkTimer = 0;
  private sinkListDir = 1;
  private baseSailColor: THREE.Color;
  private burning = false;
  private sailDisabled = false;
  private readonly hullClass: HullClass;
  private readonly masts: 1 | 2;
  private readonly livery: ShipLivery;
  private readonly seed: number;

  constructor(
    stats: ShipStats,
    opts: {
      scale?: number;
      loadout?: CannonLoadout;
      masts?: 1 | 2;
      hullClass?: HullClass;
      livery?: Partial<ShipLivery>;
      /** Stable per-captain number; drives weathering and the pennant's flap
       * phase so two ships in the same livery still aren't clones. */
      seed?: number;
    } = {},
  ) {
    this.stats = stats;
    this.scale = opts.scale ?? 1;
    this.loadout = opts.loadout ?? { ...DEFAULT_LOADOUT };
    this.maxHealth = 60 + stats.hullLevel * 40;
    this.health = this.maxHealth;
    this.hullClass = opts.hullClass ?? 0;
    this.masts = opts.masts ?? 1;
    this.livery = { ...DEFAULT_LIVERY, ...opts.livery };
    this.seed = opts.seed ?? Math.floor(Math.random() * 1000);

    this.group = new THREE.Group();

    // Hull. DoubleSide because the deck is recessed inside a bulwark: from the
    // chase camera you look at the *inner* face of the topsides, which is a
    // back face of the lofted shell, and front-face culling would let you see
    // straight through the hull to the ocean beyond.
    this.hullMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.72,
      map: woodGrainTexture(),
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    const hull = new THREE.Mesh(
      buildLoftedHullGeometry(this.scale, this.hullClass, this.livery, this.seed),
      this.hullMat,
    );
    hull.castShadow = true;
    hull.receiveShadow = true;
    hull.name = 'hull';
    this.group.add(hull);

    // Rig — everything else, in one mesh.
    this.rigMesh = new THREE.Mesh(
      buildRigGeometry(this.scale, this.hullClass, this.masts, this.loadout, this.livery, this.seed),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        map: woodGrainTexture(),
        roughness: 0.78,
        metalness: 0.05,
      }),
    );
    this.rigMesh.castShadow = true;
    this.rigMesh.receiveShadow = true;
    this.group.add(this.rigMesh);

    // Sails.
    this.sailMat = new THREE.MeshStandardMaterial({
      color: this.livery.sail,
      map: sailAtlasTexture(this.livery.emblem % EMBLEM_COUNT),
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.95,
      metalness: 0,
      // Canvas is thin: sunlight on the far side lights the near side up. The
      // chase camera looks at the SHADOWED back of the mainsail, which without
      // this reads as a flat grey card — the single worst thing about how the
      // ship used to look from where the player actually sits.
      //
      // Routed through emissiveMap, not a flat emissive: three adds `emissive`
      // AFTER the diffuse map, so a flat term floods the heraldry with light
      // and the device washes out to a pale ghost exactly when the sail is in
      // shadow, which is the one time the player is looking at it.
      emissive: new THREE.Color(this.livery.sail).multiplyScalar(0.26),
      emissiveMap: sailAtlasTexture(this.livery.emblem % EMBLEM_COUNT),
    });
    this.sailsMesh = new THREE.Mesh(buildSailsGeometry(this.scale, this.hullClass, this.masts), this.sailMat);
    this.sailsMesh.castShadow = true;
    this.sailsMesh.name = 'sail';
    this.group.add(this.sailsMesh);
    this.baseSailColor = this.sailMat.color.clone();

    const foam = buildFoamCollar(this.scale, this.hullClass);
    this.foamMat = foam.material as THREE.MeshBasicMaterial;
    this.group.add(foam);
  }

  get topSpeed() {
    return 6 + this.stats.sailLevel * 2.2;
  }

  setLoadout(loadout: CannonLoadout) {
    this.loadout = { ...loadout };
    // Guns live inside the merged rig, so a loadout change rebuilds that one
    // geometry. It happens at the shipyard, not in combat.
    this.rigMesh.geometry.dispose();
    this.rigMesh.geometry = buildRigGeometry(
      this.scale,
      this.hullClass,
      this.masts,
      this.loadout,
      this.livery,
      this.seed,
    );
  }

  flashHit() {
    this.hitFlash = 1;
  }

  /** Chain-shot rigging damage / fire-shot ignition, mirrored from the
   * server's sailDisabled/burning snapshot fields — sail dims to show it's
   * fouled, hull gets a smoldering glow so a burning ship reads at a glance. */
  setStatusEffects(sailDisabled: boolean, burning: boolean) {
    if (sailDisabled !== this.sailDisabled) {
      this.sailDisabled = sailDisabled;
      const c = sailDisabled ? new THREE.Color(0x8a8378) : this.baseSailColor;
      this.sailMat.color.copy(c);
      this.sailMat.emissive.copy(c).multiplyScalar(sailDisabled ? 0.12 : 0.26);
    }
    this.burning = burning;
  }

  updateHitFlash(dt: number, time: number) {
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    const burnGlow = this.burning ? 0.35 + Math.sin(time * 9) * 0.15 : 0;
    const r = Math.max(this.hitFlash, burnGlow);
    const g = Math.max(this.hitFlash * 0.85, burnGlow * 0.25);
    const b = Math.max(this.hitFlash * 0.75, 0);
    this.hullMat.emissive.setRGB(r, g, b);
  }

  /** Starts the sink animation; safe to call every frame while dead. */
  beginSinking() {
    if (this.sinking) return;
    this.sinking = true;
    this.sinkTimer = 0;
    this.sinkListDir = Math.random() < 0.5 ? -1 : 1;
  }

  /** Cancels the sink animation (e.g. after a respawn); safe to call every frame while alive. */
  resetSink() {
    this.sinking = false;
    this.sinkTimer = 0;
  }

  updateSink(dt: number) {
    if (this.sinking) this.sinkTimer = Math.min(SINK_DURATION, this.sinkTimer + dt);
  }

  dispose() {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) disposeMesh(obj);
    });
  }

  /**
   * @param waveHeight wave height at the ship's own x/z
   * @param waveAt optional sampler for wave height at an arbitrary x/z. When
   *   supplied the hull rides the chord between its bow and stern instead of
   *   sitting flat at its centre height. Reused, not allocated.
   */
  syncVisual(waveHeight: number, time: number, waveAt?: (x: number, z: number) => number) {
    let baseY = waveHeight;
    let pitch = 0;
    if (waveAt) {
      const fx = Math.sin(this.heading);
      const fz = Math.cos(this.heading);
      const arm = HULL_HALF_LENGTH * this.scale * 0.85;
      const hBow = waveAt(this.position.x + fx * arm, this.position.z + fz * arm);
      const hStern = waveAt(this.position.x - fx * arm, this.position.z - fz * arm);
      baseY = (hBow + hStern) * 0.5;
      // +rotation.x drops the bow (rotX maps local +z to -sin(a)), so negate.
      pitch = -Math.atan2(hBow - hStern, 2 * arm);
    }

    if (this.sinking) {
      const t = this.sinkTimer / SINK_DURATION;
      const eased = t * t;
      this.group.position.set(this.position.x, baseY - eased * 2.5, this.position.z);
      this.group.rotation.y = this.heading;
      this.group.rotation.z = this.sinkListDir * eased * 0.9;
      this.group.rotation.x = pitch * (1 - eased) + eased * 0.4;
      this.foamMat.opacity = Math.max(0, 0.6 * (1 - t * 3));
      return;
    }
    this.group.position.set(this.position.x, baseY, this.position.z);
    this.group.rotation.y = this.heading;
    const bob = Math.sin(time * 1.6 + this.bobPhase) * 0.05;
    this.group.rotation.z = bob;
    this.group.rotation.x = pitch + Math.sin(time * 1.3 + this.bobPhase) * 0.02;
    const speedFrac = Math.min(Math.abs(this.speed) / this.topSpeed, 1);
    // Every sail is one mesh pivoting about x=0 — which is exactly where all
    // the masts are — so trimming the whole mesh trims each sail correctly.
    this.sailsMesh.rotation.y = speedFrac * 0.16;
    // Never zero — a hove-to ship still has a wet waterline — but a moving one
    // throws noticeably more. The ocean shader draws the volume of foam
    // analytically; this collar's job is only the hull/water contact line.
    this.foamMat.opacity = 0.34 + speedFrac * 0.3 + Math.sin(time * 3.1 + this.bobPhase) * 0.04;
  }

  forwardDirection(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
  }
}
