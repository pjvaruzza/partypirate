import * as THREE from 'three';
import { specklTexture } from './Textures';
import {
  ARCHETYPE_ATOLL,
  ARCHETYPE_CAY,
  ARCHETYPE_HOME,
  ARCHETYPE_MESA,
  ARCHETYPE_RIDGE,
  ARCHETYPE_VOLCANIC,
  coastlineShape,
  seededRandom,
  type CoastlineShape,
} from './Coastline';

/** Islands used to be exactly one silhouette — a hemisphere with a wobbled rim
 * sitting on a sand cylinder — scaled to N different sizes. A dozen of those
 * reads as a dozen copies of the same green nub, which is precisely the
 * complaint. This replaces the primitives with a polar HEIGHTFIELD driven by
 * one of six archetype profiles (volcanic cone, atoll + lagoon, cliff mesa,
 * multi-peak ridge, low sand cay, and the home port's broad terrace), plus
 * multi-octave relief and slope-aware colouring. Same triangle budget as the
 * hemisphere+cylinder it replaces (~2.8k vs ~3.1k), one mesh instead of two.
 */

/** Angular resolution of the coastline. */
const SEGS = 64;
/** Rings from centre out to the waterline... */
const RINGS_LAND = 15;
/** ...and on out over the submerged shelf, which exists purely so the land
 * never appears to be a cut-out sitting on top of the water plane. */
const RINGS_TOTAL = 22;
/** Shelf extent as a multiple of the waterline radius. */
const SHELF_OUTER = 1.5;

// ---------------------------------------------------------------------------
// value noise
// ---------------------------------------------------------------------------

function hash2(ix: number, iy: number, seed: number): number {
  let h = (seed ^ Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

function fbm(x: number, y: number, seed: number, octaves: number): number {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    v += amp * vnoise(x * f, y * f, seed + i * 7919);
    f *= 2.07;
    amp *= 0.5;
  }
  return v;
}

// ---------------------------------------------------------------------------
// archetype profiles
// ---------------------------------------------------------------------------

export interface TerrainParams {
  /** Peak land height in world units. */
  height: number;
  /** Height above sea level at which sand gives way to vegetation/rock. */
  sandLine: number;
  /** Elevation (0..1 of `height`) above which vegetation stops. */
  treeLine: number;
  /** Base rock/soil/vegetation palette for this island. */
  rock: THREE.Color;
  rockDark: THREE.Color;
  veg: THREE.Color;
  vegDark: THREE.Color;
  sand: THREE.Color;
  /** Does this archetype support palms/scrub at all? */
  vegetated: boolean;
}

interface ProfileState {
  craterDepth: number;
  cliffAxis: number;
  ringGapAxis: number;
  peaks: { x: number; z: number; r: number; h: number }[];
  reliefAmp: number;
  reliefScale: number;
  /** How many ridge spurs run down the flanks of a peaked island. */
  spurCount: number;
  spurPhase: number;
}

function makeProfileState(shape: CoastlineShape, archetype: number): ProfileState {
  const rnd = seededRandom(shape.seed ^ 0x9e3779b9);
  const peaks: { x: number; z: number; r: number; h: number }[] = [];
  if (archetype === ARCHETYPE_RIDGE) {
    const n = 2 + (rnd() < 0.45 ? 1 : 0);
    // Peaks strung along the elongation axis so the ridge line and the
    // island's long axis agree instead of fighting.
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
      const off = t * 0.42;
      peaks.push({
        x: Math.cos(shape.axis) * off + (rnd() - 0.5) * 0.12,
        z: Math.sin(shape.axis) * off + (rnd() - 0.5) * 0.12,
        r: 0.42 + rnd() * 0.18,
        h: 0.62 + rnd() * 0.38,
      });
    }
  }
  return {
    craterDepth: rnd() < 0.5 ? 0.28 + rnd() * 0.22 : 0,
    cliffAxis: rnd() * Math.PI * 2,
    ringGapAxis: rnd() * Math.PI * 2,
    peaks,
    reliefAmp: 0.12 + rnd() * 0.1,
    reliefScale: 2.4 + rnd() * 1.6,
    spurCount: 3 + Math.floor(rnd() * 4),
    spurPhase: rnd() * Math.PI * 2,
  };
}

/** Ridge spurs and gullies running down a peak's flanks. Forced to zero at
 * the waterline. Without this a `pow(1-u, k)` cone renders as a geometrically
 * perfect triangle from every bearing — which is the "nub" silhouette this
 * whole rewrite exists to kill. */
function spurs(u: number, angle: number, st: ProfileState): number {
  const fall = (1 - u) * Math.sin(Math.min(1, u / 0.98) * Math.PI);
  return (
    (0.42 * Math.sin(angle * st.spurCount + st.spurPhase) +
      0.2 * Math.sin(angle * (st.spurCount * 2 + 1) - st.spurPhase * 1.7) +
      0.11 * Math.sin(angle * (st.spurCount * 3 + 2) + st.spurPhase * 0.6)) *
    fall
  );
}

/** Normalised land profile: 1 at the summit, 0 at the waterline (u === 1).
 * May go NEGATIVE inside an atoll, which is what carves the lagoon. */
function profile(archetype: number, u: number, angle: number, st: ProfileState): number {
  const edge = smoothstep(1.0, 0.9, u); // guarantees a clean 0 at the coast

  switch (archetype) {
    case ARCHETYPE_VOLCANIC: {
      let p = Math.pow(Math.max(0, 1 - u), 1.45) + spurs(u, angle, st) * 0.34;
      if (st.craterDepth > 0 && u < 0.22) {
        // A rim at u ~= 0.22 with the cone's tip scooped out behind it.
        const c = 1 - u / 0.22;
        p -= st.craterDepth * c * c;
      }
      return Math.max(p, 0) * edge;
    }
    case ARCHETYPE_ATOLL: {
      // A sand ring around a lagoon, with one or two passes where the ring
      // dips under water — the gaps are what make it read as an atoll rather
      // than a donut.
      const gap = 0.62 + 0.38 * Math.cos(angle - st.ringGapAxis);
      const ring = Math.exp(-Math.pow(u - 0.74, 2) / 0.026) * gap;
      const lagoon = 1.35 * smoothstep(0.66, 0.3, u);
      return (ring - lagoon) * edge;
    }
    case ARCHETYPE_MESA: {
      // Steep cliff on one bearing, gentle beach opposite.
      const cliffness = smoothstep(-0.25, 0.75, Math.cos(angle - st.cliffAxis));
      const shoulder = 0.55 + 0.33 * cliffness;
      let p = smoothstep(1.0, shoulder, u);
      // A slightly domed, not perfectly flat, tableland.
      p *= 0.88 + 0.12 * Math.cos(u * Math.PI * 0.5);
      return p;
    }
    case ARCHETYPE_RIDGE: {
      const qx = u * Math.cos(angle);
      const qz = u * Math.sin(angle);
      let p = 0;
      for (const pk of st.peaks) {
        const dx = qx - pk.x;
        const dz = qz - pk.z;
        p = Math.max(p, pk.h * Math.exp(-(dx * dx + dz * dz) / (pk.r * pk.r)));
      }
      return Math.max(0, p + spurs(u, angle, st) * 0.24) * edge;
    }
    case ARCHETYPE_CAY: {
      // Barely above water: broad flats with a couple of low dunes.
      const dune = 0.55 + 0.45 * Math.sin(angle * 2 + st.ringGapAxis);
      return Math.pow(Math.max(0, 1 - u), 0.8) * (0.55 + 0.45 * dune) * edge;
    }
    case ARCHETYPE_HOME:
    default: {
      // A stepped terrace, not a dome: a wide flat shelf for the huts at
      // ~0.55 height, then a knoll for the flagpole. The home port is the
      // first land every player ever sees, so it gets the most deliberate
      // silhouette of the six.
      const shelf = smoothstep(0.98, 0.8, u) * 0.5;
      const upper = smoothstep(0.7, 0.56, u) * 0.28;
      const knoll = smoothstep(0.34, 0.05, u) * 0.22;
      return shelf + upper + knoll;
    }
  }
}

export function terrainParams(radius: number, archetype: number, shape: CoastlineShape): TerrainParams {
  const rnd = seededRandom(shape.seed ^ 0x5bf03635);
  // Small per-island hue drift so even two islands of the same archetype
  // aren't the same colour.
  const hue = (rnd() - 0.5) * 0.045;
  const tint = (hex: number, dh: number, ds = 0, dl = 0) => {
    const c = new THREE.Color(hex);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL((hsl.h + dh + 1) % 1, THREE.MathUtils.clamp(hsl.s + ds, 0, 1), THREE.MathUtils.clamp(hsl.l + dl, 0, 1));
    return c;
  };

  switch (archetype) {
    case ARCHETYPE_VOLCANIC:
      return {
        // Was radius * (0.95..1.3): at that aspect ratio a volcanic island is
        // taller than it is wide and reads as a spike, not an island.
        height: radius * (0.6 + rnd() * 0.32),
        sandLine: radius * 0.05,
        treeLine: 0.62,
        rock: tint(0x6d6257, hue),
        rockDark: tint(0x2e2822, hue),
        veg: tint(0x39762f, hue),
        vegDark: tint(0x1d4a26, hue),
        sand: tint(0xcbb98d, hue),
        vegetated: true,
      };
    case ARCHETYPE_ATOLL:
      return {
        height: radius * (0.13 + rnd() * 0.05),
        sandLine: radius * 0.045,
        treeLine: 0.95,
        rock: tint(0xbfae86, hue),
        rockDark: tint(0x8a7c5c, hue),
        veg: tint(0x4e9c46, hue),
        vegDark: tint(0x2f7038, hue),
        sand: tint(0xe4d3a4, hue),
        vegetated: true,
      };
    case ARCHETYPE_MESA:
      return {
        height: radius * (0.5 + rnd() * 0.22),
        sandLine: radius * 0.04,
        treeLine: 0.85,
        rock: tint(0xa8794e, hue, 0.04),
        rockDark: tint(0x6b4530, hue),
        veg: tint(0x6d8a3a, hue),
        vegDark: tint(0x415c28, hue),
        sand: tint(0xd8c294, hue),
        vegetated: true,
      };
    case ARCHETYPE_RIDGE:
      return {
        height: radius * (0.7 + rnd() * 0.28),
        sandLine: radius * 0.05,
        treeLine: 0.78,
        rock: tint(0x7d7a72, hue),
        rockDark: tint(0x43423d, hue),
        veg: tint(0x35803a, hue),
        vegDark: tint(0x1f5230, hue),
        sand: tint(0xd2bf92, hue),
        vegetated: true,
      };
    case ARCHETYPE_CAY:
      return {
        height: radius * (0.11 + rnd() * 0.05),
        sandLine: radius * 0.06,
        treeLine: 0.98,
        rock: tint(0xc9b98f, hue),
        rockDark: tint(0x9a8a63, hue),
        veg: tint(0x63a556, hue),
        vegDark: tint(0x3d7a3f, hue),
        sand: tint(0xeaddb0, hue),
        vegetated: true,
      };
    case ARCHETYPE_HOME:
    default:
      return {
        height: radius * 0.52,
        sandLine: radius * 0.045,
        treeLine: 0.92,
        rock: new THREE.Color(0x8f8264),
        rockDark: new THREE.Color(0x574c38),
        veg: new THREE.Color(0x53a049),
        vegDark: new THREE.Color(0x2f6f36),
        sand: new THREE.Color(0xe0cb9b),
        vegetated: true,
      };
  }
}

export interface TerrainResult {
  mesh: THREE.Mesh;
  params: TerrainParams;
  /** Land surface height at a point in island-local coordinates. Negative
   * below sea level. Props use this to sit on the ground. */
  heightAt: (x: number, z: number) => number;
  /** Waterline radius at a given bearing. */
  shoreRadius: (angle: number) => number;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

let terrainMaterial: THREE.MeshStandardMaterial | null = null;
function sharedTerrainMaterial(): THREE.MeshStandardMaterial {
  if (!terrainMaterial) {
    terrainMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: specklTexture(),
      roughness: 0.96,
      // Every island now shares one material instance rather than allocating
      // its own — colour lives entirely in the vertex attribute.
      side: THREE.FrontSide,
    });
  }
  return terrainMaterial;
}

export function buildTerrain(radius: number, shape: CoastlineShape): TerrainResult {
  const archetype = shape.archetype;
  const params = terrainParams(radius, archetype, shape);
  const st = makeProfileState(shape, archetype);
  const seed = shape.seed;

  // Relief is sampled in island-local CARTESIAN space, not by angle: the
  // polar grid's longitude lines all converge at the centre, so any
  // angle-driven detail aliases into a starburst there (the old hemisphere
  // needed an explicit pole fade to hide exactly that). Cartesian noise has
  // no pole to alias at.
  const reliefScale = st.reliefScale / radius;
  const shelfDrop = radius * 0.22 + 3;

  const shoreRadius = (angle: number) =>
    shape.scale * coastlineShape(angle, shape.phase, shape.elongation, shape.axis);

  /** The full height field, in island-local coordinates. */
  function heightAt(x: number, z: number): number {
    const r = Math.hypot(x, z);
    const angle = Math.atan2(z, x);
    const rc = shoreRadius(angle);
    const u = r / rc;
    if (u >= 1) {
      const s = THREE.MathUtils.clamp((u - 1) / (SHELF_OUTER - 1), 0, 1);
      return -shelfDrop * Math.pow(s, 1.5);
    }
    const base = profile(archetype, u, angle, st) * params.height;
    // Relief tapers out at the coast (a ragged waterline reads as z-fighting
    // with the sea, not as terrain) and scales with how much land there is
    // underneath it.
    const coastFade = smoothstep(1.0, 0.82, u);
    const amp = params.height * st.reliefAmp * coastFade;
    const detail = (fbm(x * reliefScale, z * reliefScale, seed, 4) - 0.5) * 2 * amp;
    const fine = (fbm(x * reliefScale * 4.3, z * reliefScale * 4.3, seed + 131, 2) - 0.5) * amp * 0.45;
    return base + detail + fine;
  }

  // --- geometry ------------------------------------------------------------
  const vertCount = (RINGS_TOTAL + 1) * (SEGS + 1);
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices: number[] = [];

  for (let ring = 0; ring <= RINGS_TOTAL; ring++) {
    // Ring radii are packed toward the waterline, where the eye actually is.
    let rNorm: number;
    if (ring <= RINGS_LAND) {
      rNorm = Math.pow(ring / RINGS_LAND, 0.82);
    } else {
      const s = (ring - RINGS_LAND) / (RINGS_TOTAL - RINGS_LAND);
      rNorm = 1 + (SHELF_OUTER - 1) * Math.pow(s, 1.35);
    }
    for (let seg = 0; seg <= SEGS; seg++) {
      const angle = (seg / SEGS) * Math.PI * 2;
      const rc = shoreRadius(angle);
      const r = rNorm * rc;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const i = ring * (SEGS + 1) + seg;
      positions[i * 3] = x;
      positions[i * 3 + 1] = heightAt(x, z);
      positions[i * 3 + 2] = z;
      // World-scale UVs so the speckle grain is the same size on a 12-unit
      // rock and a 40-unit landmass.
      uvs[i * 2] = x * 0.055;
      uvs[i * 2 + 1] = z * 0.055;
    }
  }

  for (let ring = 0; ring < RINGS_TOTAL; ring++) {
    for (let seg = 0; seg < SEGS; seg++) {
      // Winding matters: seg increases counter-clockwise in the XZ plane and
      // ring increases outward, so (a, b, d) / (a, d, c) is the ordering
      // whose face normals point UP. The transposed ordering builds a
      // terrain lit entirely from below — it renders as a black silhouette
      // with a correctly-lit beach, which is exactly what the first build of
      // this file did.
      const a = ring * (SEGS + 1) + seg;
      const b = a + 1;
      const c = a + (SEGS + 1);
      const d = c + 1;
      if (ring > 0) indices.push(a, b, d);
      indices.push(a, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  // --- vertex colours ------------------------------------------------------
  // Slope-aware rather than purely height-banded: a cliff face and a meadow
  // at the same elevation should not be the same colour, and that difference
  // is most of what makes a heightfield read as terrain rather than as a
  // tinted dome.
  const normals = geo.attributes.normal as THREE.BufferAttribute;
  const colorArr = new Float32Array(vertCount * 3);
  const c = new THREE.Color();
  const wetSand = params.sand.clone().multiplyScalar(0.62);
  for (let i = 0; i < vertCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const slope = 1 - THREE.MathUtils.clamp(normals.getY(i), 0, 1);
    const t = THREE.MathUtils.clamp(y / Math.max(params.height, 0.001), 0, 1);

    if (y < params.sandLine) {
      // Beach: wet and dark at the water's edge, bleached higher up.
      const w = THREE.MathUtils.clamp((y + 0.6) / (params.sandLine + 0.6), 0, 1);
      c.copy(wetSand).lerp(params.sand, w);
    } else {
      // Rock vs vegetation by steepness; the threshold itself is noisy so the
      // boundary isn't a contour line.
      const noiseAtV = fbm(x * reliefScale * 2.2, z * reliefScale * 2.2, seed + 5501, 3);
      const rockiness = THREE.MathUtils.clamp(
        (slope - (0.34 + (noiseAtV - 0.5) * 0.28)) / 0.22 + Math.max(0, (t - params.treeLine) / 0.16),
        0,
        1,
      );
      // Horizontal strata on the exposed rock — the single cheapest cue that
      // a cliff is stone and not a brown-painted slope.
      const strata = 0.86 + 0.14 * Math.sin(y * (5.5 / Math.max(1, params.height * 0.25)) + noiseAtV * 3.0);
      const rockCol = params.rockDark.clone().lerp(params.rock, THREE.MathUtils.clamp(noiseAtV * 1.3, 0, 1)).multiplyScalar(strata);
      const vegCol = params.vegDark.clone().lerp(params.veg, THREE.MathUtils.clamp(0.25 + noiseAtV * 1.1 - t * 0.45, 0, 1));
      c.copy(vegCol).lerp(rockCol, rockiness);
      // Blend into the sand across a short band so the beach doesn't end in
      // a drawn line.
      const beachBlend = smoothstep(params.sandLine, params.sandLine + Math.max(0.5, params.height * 0.1), y);
      c.lerp(params.sand, 1 - beachBlend);
    }

    // Baked concavity ("is this vertex sitting in a gully or on a spur?"),
    // used as a cheap ambient-occlusion term. Directional lighting alone
    // can't distinguish a valley from a ridge when both face the sun, which
    // is why the first pass of this heightfield still looked like a smoothly
    // tinted dome despite having real relief in it.
    if (y > -0.2) {
      const d = Math.max(0.7, radius * 0.05);
      const around =
        (heightAt(x + d, z) + heightAt(x - d, z) + heightAt(x, z + d) + heightAt(x, z - d)) * 0.25;
      const concavity = THREE.MathUtils.clamp((around - y) / (d * 0.55), -1, 1);
      c.multiplyScalar(1 - concavity * 0.3);
    }

    // Fine per-vertex grain, seeded (not Math.random) so every client agrees.
    const grain = 0.93 + hash2(Math.round(x * 7), Math.round(z * 7), seed) * 0.14;
    c.multiplyScalar(grain);
    c.toArray(colorArr, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));

  const mesh = new THREE.Mesh(geo, sharedTerrainMaterial());
  // Deliberately NOT castShadow: a directional shadow map renders a hill's
  // own broad relief as one soft dark smear across the slope, which reads as
  // a dirt stain rather than terrain form. The heightfield's real normals do
  // the shading work. Still receives shadows from ships and palms.
  mesh.receiveShadow = true;

  return { mesh, params, heightAt, shoreRadius };
}
