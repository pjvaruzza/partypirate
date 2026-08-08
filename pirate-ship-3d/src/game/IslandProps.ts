import * as THREE from 'three';
import { GeoBuilder } from './GeoBuilder';
import { woodGrainTexture } from './Textures';
import {
  ARCHETYPE_ATOLL,
  ARCHETYPE_CAY,
  ARCHETYPE_HOME,
  ARCHETYPE_MESA,
  ARCHETYPE_RIDGE,
  ARCHETYPE_VOLCANIC,
  seededRandom,
  type CoastlineShape,
} from './Coastline';
import type { TerrainResult } from './IslandTerrain';

/** Everything an island wears: palms, scrub, boulders, offshore sea stacks,
 * wrecked hulls, stone ruins, and the home port's dock and huts. All of it is
 * baked into ONE vertex-coloured geometry per island (see GeoBuilder), so a
 * fully dressed island costs a single draw call — the previous "two palms and
 * three icosahedron rocks" dressing already cost about ten.
 *
 * The point is narrative as much as decorative: an island with a half-sunk
 * hull on its reef and a broken watchtower on its ridge reads as a place
 * something happened, which a bare hill never will no matter how well shaded.
 */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function place(pos: THREE.Vector3, rotY: number, scale: number | THREE.Vector3, tiltAxis?: THREE.Vector3, tilt = 0) {
  if (tiltAxis && tilt !== 0) {
    _q.setFromAxisAngle(tiltAxis, tilt).premultiply(new THREE.Quaternion().setFromAxisAngle(_up, rotY));
  } else {
    _q.setFromAxisAngle(_up, rotY);
  }
  if (typeof scale === 'number') _s.setScalar(scale);
  else _s.copy(scale);
  return _m.compose(pos, _q, _s);
}

// --- shared source primitives (created once, transformed per instance) ------
let boulderGeos: THREE.BufferGeometry[] | null = null;
function boulders(): THREE.BufferGeometry[] {
  if (!boulderGeos) {
    boulderGeos = [];
    for (let v = 0; v < 3; v++) {
      const g = new THREE.IcosahedronGeometry(1, 0);
      const pos = g.attributes.position as THREE.BufferAttribute;
      const rnd = seededRandom(1234 + v * 77);
      for (let i = 0; i < pos.count; i++) {
        const f = 0.7 + rnd() * 0.6;
        pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f * 0.8, pos.getZ(i) * f);
      }
      g.computeVertexNormals();
      boulderGeos.push(g);
    }
  }
  return boulderGeos;
}

let boxGeo: THREE.BufferGeometry | null = null;
function unitBox(): THREE.BufferGeometry {
  if (!boxGeo) boxGeo = new THREE.BoxGeometry(1, 1, 1);
  return boxGeo;
}

let coneGeo: THREE.BufferGeometry | null = null;
function unitCone(): THREE.BufferGeometry {
  if (!coneGeo) coneGeo = new THREE.ConeGeometry(1, 1, 4);
  return coneGeo;
}

let cylGeo: THREE.BufferGeometry | null = null;
function unitCylinder(): THREE.BufferGeometry {
  if (!cylGeo) cylGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
  return cylGeo;
}

let spireGeo: THREE.BufferGeometry | null = null;
/** A weathered rock spire — a tall 7-sided cylinder pinched and kinked so it
 * doesn't read as a cone. Unit height, unit base radius. */
function spire(): THREE.BufferGeometry {
  if (!spireGeo) {
    const g = new THREE.CylinderGeometry(0.35, 1, 1, 7, 4);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const rnd = seededRandom(90210);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) + 0.5;
      const f = 1 + (rnd() - 0.5) * 0.34;
      const lean = y * y * 0.22;
      pos.setXYZ(i, pos.getX(i) * f + lean, pos.getY(i), pos.getZ(i) * f);
    }
    g.computeVertexNormals();
    spireGeo = g;
  }
  return spireGeo;
}

// --- palms -----------------------------------------------------------------

/** Emits a coconut palm directly into the builder: a curved, tapered trunk
 * with ring texture and 6-8 drooping fronds, each a folded tapering strip.
 * Built per-instance rather than instanced from one master because the whole
 * appeal of a palm grove is that no two lean the same way. */
function addPalm(
  b: GeoBuilder,
  base: THREE.Vector3,
  height: number,
  rnd: () => number,
  trunkColor: THREE.Color,
  frondColor: THREE.Color,
) {
  const leanDir = rnd() * Math.PI * 2;
  const lean = (0.14 + rnd() * 0.26) * height;
  const RAD = 6;
  const STEPS = 5;
  const rBase = height * 0.035;
  const rTop = height * 0.02;

  const ring: THREE.Vector3[][] = [];
  for (let s = 0; s <= STEPS; s++) {
    const t = s / STEPS;
    // Palms bend as a smooth arc, strongest near the crown.
    const off = lean * t * t;
    const cx = base.x + Math.cos(leanDir) * off;
    const cz = base.z + Math.sin(leanDir) * off;
    const cy = base.y + height * t;
    const r = rBase + (rTop - rBase) * t;
    const pts: THREE.Vector3[] = [];
    for (let a = 0; a < RAD; a++) {
      const ang = (a / RAD) * Math.PI * 2;
      // Slight per-ring wobble reads as bark scarring.
      const rr = r * (0.9 + 0.2 * ((s * 7 + a * 3) % 5) / 5);
      pts.push(new THREE.Vector3(cx + Math.cos(ang) * rr, cy, cz + Math.sin(ang) * rr));
    }
    ring.push(pts);
  }

  const tri: number[] = [];
  for (let s = 0; s < STEPS; s++) {
    for (let a = 0; a < RAD; a++) {
      const a2 = (a + 1) % RAD;
      const p0 = ring[s][a];
      const p1 = ring[s][a2];
      const p2 = ring[s + 1][a];
      const p3 = ring[s + 1][a2];
      tri.push(p0.x, p0.y, p0.z, p2.x, p2.y, p2.z, p1.x, p1.y, p1.z);
      tri.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z);
    }
  }
  b.addTriangles(tri, trunkColor);

  const crown = new THREE.Vector3(
    base.x + Math.cos(leanDir) * lean,
    base.y + height,
    base.z + Math.sin(leanDir) * lean,
  );

  const frondCount = 6 + Math.floor(rnd() * 3);
  const frondLen = height * (0.42 + rnd() * 0.14);
  const angle0 = rnd() * Math.PI * 2;
  for (let f = 0; f < frondCount; f++) {
    const ang = angle0 + (f / frondCount) * Math.PI * 2 + (rnd() - 0.5) * 0.35;
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    const rise = frondLen * (0.22 + rnd() * 0.16);
    const droop = frondLen * (0.55 + rnd() * 0.3);
    const width = frondLen * (0.16 + rnd() * 0.05);
    const SEG = 5;
    const ft: number[] = [];
    let prev: [THREE.Vector3, THREE.Vector3, THREE.Vector3] | null = null;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const out = frondLen * t;
      const y = crown.y + rise * Math.sin(t * Math.PI * 0.62) - droop * t * t;
      const cx = crown.x + dx * out;
      const cz = crown.z + dz * out;
      const w = width * Math.pow(Math.sin(Math.min(1, t * 1.05) * Math.PI), 0.55) * (1 - t * 0.35);
      // Perpendicular in the ground plane, plus a raised spine so the frond
      // is a shallow V rather than a flat card.
      const px = -dz * w;
      const pz = dx * w;
      const spine = new THREE.Vector3(cx, y + w * 0.45, cz);
      const left = new THREE.Vector3(cx + px, y, cz + pz);
      const right = new THREE.Vector3(cx - px, y, cz - pz);
      if (prev) {
        const [ps, pl, pr] = prev;
        ft.push(ps.x, ps.y, ps.z, pl.x, pl.y, pl.z, spine.x, spine.y, spine.z);
        ft.push(pl.x, pl.y, pl.z, left.x, left.y, left.z, spine.x, spine.y, spine.z);
        ft.push(ps.x, ps.y, ps.z, spine.x, spine.y, spine.z, pr.x, pr.y, pr.z);
        ft.push(pr.x, pr.y, pr.z, spine.x, spine.y, spine.z, right.x, right.y, right.z);
      }
      prev = [spine, left, right];
    }
    const shade = 0.72 + rnd() * 0.5;
    b.addTriangles(ft, frondColor.clone().multiplyScalar(shade));
  }

  // Coconuts.
  if (rnd() < 0.6) {
    const nut = new THREE.Color(0x5a4326);
    for (let i = 0; i < 3; i++) {
      const a = rnd() * Math.PI * 2;
      _v.set(crown.x + Math.cos(a) * height * 0.03, crown.y - height * 0.035, crown.z + Math.sin(a) * height * 0.03);
      b.add(boulders()[0], place(_v, 0, height * 0.028), nut);
    }
  }
}

// --- composite props -------------------------------------------------------

/** A half-wrecked hull heeled over on the reef, with a snapped mast. */
function addWreck(b: GeoBuilder, at: THREE.Vector3, facing: number, size: number, rnd: () => number) {
  const hull = new THREE.Color(0x4a3524).multiplyScalar(0.85 + rnd() * 0.2);
  const hullDark = new THREE.Color(0x2c2015);
  const heel = 0.45 + rnd() * 0.35;
  const axis = new THREE.Vector3(Math.cos(facing), 0, Math.sin(facing));

  // Four tapering hull segments, the aftmost broken off and lower. Kept long
  // and narrow (0.24 beam / 0.2 depth against a 0.62 segment length): the
  // first version used 0.42 x 0.34 against 0.5, which is a cube, and a cube
  // on a beach reads as a shipping crate rather than a wrecked hull.
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const len = size * 0.62;
    const beam = size * (0.26 - t * 0.11);
    const depth = size * (0.22 - t * 0.07);
    _v.copy(at)
      .addScaledVector(axis, (i - 1.5) * len * 0.9)
      .add(new THREE.Vector3(0, -t * size * 0.12 - size * 0.03, 0));
    b.add(unitBox(), place(_v, facing, new THREE.Vector3(len, depth, beam), axis, heel), i >= 2 ? hullDark : hull);
  }
  // Ribs poking out of the broken end.
  const ribAt = _v.clone();
  for (let i = 0; i < 5; i++) {
    const o = (i / 4 - 0.5) * size * 0.16;
    _v.copy(ribAt).addScaledVector(axis, size * 0.34).add(new THREE.Vector3(-Math.sin(facing) * o, size * 0.09, Math.cos(facing) * o));
    b.add(unitBox(), place(_v, facing, new THREE.Vector3(size * 0.3, size * 0.035, size * 0.025), axis, heel + 0.35), hullDark);
  }
  // Snapped mast, canted with the hull.
  _v.copy(at).addScaledVector(axis, -size * 0.1).add(new THREE.Vector3(0, size * 0.2, 0));
  const mastLen = size * (0.9 + rnd() * 0.7);
  const perp = new THREE.Vector3(-Math.sin(facing), 0, Math.cos(facing));
  b.add(unitCylinder(), place(_v, 0, new THREE.Vector3(size * 0.035, mastLen, size * 0.035), perp, heel + 0.25), hullDark);
}

/** A broken stone watchtower — three drum sections, the top one snapped at an
 * angle, plus a fallen wall fragment. */
function addRuin(b: GeoBuilder, at: THREE.Vector3, size: number, rnd: () => number) {
  const stone = new THREE.Color(0x8d8779);
  const stoneDark = new THREE.Color(0x5d574c);
  const drums = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < drums; i++) {
    const h = size * (0.5 - i * 0.06);
    const r = size * (0.42 - i * 0.05);
    _v.copy(at).add(new THREE.Vector3(0, h * 0.5 + i * h * 0.95, 0));
    b.add(unitCylinder(), place(_v, rnd() * 0.4, new THREE.Vector3(r, h, r)), i % 2 ? stoneDark : stone);
  }
  // Snapped crown: a wedge sliced off the top.
  _v.copy(at).add(new THREE.Vector3(size * 0.12, size * 0.5 * drums, 0));
  b.add(
    unitBox(),
    place(_v, rnd() * Math.PI, new THREE.Vector3(size * 0.5, size * 0.22, size * 0.34), new THREE.Vector3(1, 0, 0), 0.5),
    stoneDark,
  );
  // Fallen block at the base.
  _v.copy(at).add(new THREE.Vector3(size * (0.6 + rnd() * 0.4), size * 0.09, size * (rnd() - 0.5)));
  b.add(unitBox(), place(_v, rnd() * Math.PI, new THREE.Vector3(size * 0.3, size * 0.18, size * 0.26)), stone);
}

/** Thatched hut: plank walls under a pyramid roof. */
function addHut(b: GeoBuilder, at: THREE.Vector3, size: number, rot: number) {
  const wall = new THREE.Color(0x8e6a41);
  const thatch = new THREE.Color(0xa8853f);
  _v.copy(at).add(new THREE.Vector3(0, size * 0.35, 0));
  b.add(unitBox(), place(_v, rot, new THREE.Vector3(size, size * 0.7, size * 0.85)), wall);
  _v.copy(at).add(new THREE.Vector3(0, size * 0.7 + size * 0.3, 0));
  b.add(unitCone(), place(_v, rot + Math.PI / 4, new THREE.Vector3(size * 0.95, size * 0.62, size * 0.85)), thatch);
}

/** A plank jetty on pilings, running from the beach out over the water. */
function addDock(b: GeoBuilder, from: THREE.Vector3, dir: number, length: number, rnd: () => number) {
  const plank = new THREE.Color(0x9a7448);
  const pile = new THREE.Color(0x4d3a24);
  const dx = Math.cos(dir);
  const dz = Math.sin(dir);
  const deckY = 0.85;
  const width = 2.4;
  const sections = Math.max(3, Math.round(length / 2.6));
  for (let i = 0; i < sections; i++) {
    const t = (i + 0.5) / sections;
    _v.set(from.x + dx * length * t, deckY, from.z + dz * length * t);
    b.add(
      unitBox(),
      place(_v, dir, new THREE.Vector3(length / sections, 0.22, width * (1 - t * 0.12))),
      plank.clone().multiplyScalar(0.9 + rnd() * 0.2),
    );
    for (const side of [-1, 1]) {
      _v.set(
        from.x + dx * length * t - dz * side * width * 0.42,
        deckY * 0.5 - 0.5,
        from.z + dz * length * t + dx * side * width * 0.42,
      );
      b.add(unitCylinder(), place(_v, 0, new THREE.Vector3(0.16, 2.6, 0.16)), pile);
    }
  }
  // A couple of barrels and a crate at the shore end.
  const cargo = new THREE.Color(0x7a5a34);
  for (let i = 0; i < 3; i++) {
    _v.set(from.x + dx * (1.2 + i * 0.9) - dz * (1.6 - i * 0.5), deckY + 0.45, from.z + dz * (1.2 + i * 0.9) + dx * (1.6 - i * 0.5));
    if (i === 1) b.add(unitBox(), place(_v, rnd() * 2, 0.8), cargo);
    else b.add(unitCylinder(), place(_v, 0, new THREE.Vector3(0.36, 0.9, 0.36)), cargo);
  }
}

// --- entry point -----------------------------------------------------------

let propsMaterial: THREE.MeshStandardMaterial | null = null;
function sharedPropsMaterial(): THREE.MeshStandardMaterial {
  if (!propsMaterial) {
    propsMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: woodGrainTexture(),
      roughness: 0.9,
      // Palm fronds are single-sheet strips; without DoubleSide half of every
      // crown vanishes depending on where you're standing.
      side: THREE.DoubleSide,
    });
  }
  return propsMaterial;
}

export function buildIslandProps(radius: number, shape: CoastlineShape, terrain: TerrainResult): THREE.Mesh | null {
  const rnd = seededRandom(shape.seed ^ 0x2545f491);
  const b = new GeoBuilder();
  const p = terrain.params;
  const arch = shape.archetype;

  const slopeAt = (x: number, z: number) => {
    const d = Math.max(0.6, radius * 0.03);
    const hx = terrain.heightAt(x + d, z) - terrain.heightAt(x - d, z);
    const hz = terrain.heightAt(x, z + d) - terrain.heightAt(x, z - d);
    return Math.hypot(hx, hz) / (2 * d);
  };

  /** Rejection-samples a spot on dry land matching the given constraints. */
  function findSpot(minY: number, maxY: number, maxSlope: number, minU: number, maxU: number): THREE.Vector3 | null {
    for (let attempt = 0; attempt < 24; attempt++) {
      const angle = rnd() * Math.PI * 2;
      const rc = terrain.shoreRadius(angle);
      const u = minU + rnd() * (maxU - minU);
      const x = Math.cos(angle) * rc * u;
      const z = Math.sin(angle) * rc * u;
      const y = terrain.heightAt(x, z);
      if (y < minY || y > maxY) continue;
      if (slopeAt(x, z) > maxSlope) continue;
      return new THREE.Vector3(x, y, z);
    }
    return null;
  }

  // --- palms and scrub -----------------------------------------------------
  if (p.vegetated) {
    const trunk = new THREE.Color(0x7a5c37);
    const frond = p.veg.clone().lerp(new THREE.Color(0x54c25a), 0.35);
    const palmTarget = Math.min(12, Math.round(3 + radius * 0.26));
    const palmH = Math.max(2.6, Math.min(radius * 0.28, 7));
    for (let i = 0; i < palmTarget; i++) {
      // Palms want the flat coastal fringe, not cliff faces or summits.
      const spot = findSpot(p.sandLine * 0.35, p.height * (arch === ARCHETYPE_CAY || arch === ARCHETYPE_ATOLL ? 1.1 : 0.5), 0.55, 0.25, 0.94);
      if (!spot) continue;
      addPalm(b, spot, palmH * (0.75 + rnd() * 0.55), rnd, trunk, frond);
    }

    const scrubCount = Math.round(4 + radius * 0.32);
    const scrub = p.vegDark.clone();
    for (let i = 0; i < scrubCount; i++) {
      const spot = findSpot(p.sandLine * 0.5, p.height * p.treeLine, 0.85, 0.12, 0.96);
      if (!spot) continue;
      // Roundish, not disc-flat: at 1.5 x 1.0 x 1.5 these read as dark leaves
      // lying on the hillside rather than as bushes standing on it.
      const s = radius * (0.012 + rnd() * 0.016);
      b.add(
        boulders()[Math.floor(rnd() * 3)],
        place(spot.add(new THREE.Vector3(0, s * 0.55, 0)), rnd() * 6.28, new THREE.Vector3(s * 1.15, s * 0.95, s * 1.15)),
        scrub.clone().lerp(p.veg, rnd() * 0.7),
      );
    }
  }

  // --- boulders / scree ----------------------------------------------------
  const rockCount = Math.round(3 + radius * 0.2);
  for (let i = 0; i < rockCount; i++) {
    const spot = findSpot(-0.4, p.height, 2.0, 0.1, 1.02);
    if (!spot) continue;
    const s = radius * (0.018 + rnd() * 0.045);
    b.add(
      boulders()[Math.floor(rnd() * 3)],
      place(spot.add(new THREE.Vector3(0, s * 0.3, 0)), rnd() * 6.28, new THREE.Vector3(s, s * (0.6 + rnd() * 0.6), s)),
      p.rock.clone().lerp(p.rockDark, rnd()),
    );
  }

  // --- offshore sea stacks -------------------------------------------------
  // The clearest silhouette-breaker there is: rock spires standing in open
  // water beside the island so its outline isn't a single closed curve.
  if (arch === ARCHETYPE_VOLCANIC || arch === ARCHETYPE_MESA || arch === ARCHETYPE_RIDGE) {
    const groups = 1 + Math.floor(rnd() * 2);
    for (let g = 0; g < groups; g++) {
      const angle = rnd() * Math.PI * 2;
      // Outside the waterline but inside the server's collision radius
      // (radius + 2.5), so a stack can never be something you sail through.
      // The first version used rc * (1.02..1.16) with a height of up to
      // 0.65 * island height, which on a 30-unit island produced a 2-unit-
      // wide, 16-unit-tall slab standing on the beach — a monolith, not a
      // sea stack. Height is now tied to the island's RADIUS, not its peak.
      const stacks = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < stacks; i++) {
        const a = angle + (rnd() - 0.5) * 0.5;
        const rcA = terrain.shoreRadius(a);
        const r = Math.min(rcA * (1.06 + rnd() * 0.2), radius + 1.6);
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const h = radius * (0.1 + rnd() * 0.18);
        // Deliberately squat: base radius is 35-60% of height, so these read
        // as weathered rocks rather than towers.
        const w = h * (0.35 + rnd() * 0.28);
        _v.set(x, h * 0.5 - h * 0.22, z);
        b.add(
          spire(),
          place(_v, rnd() * 6.28, new THREE.Vector3(w, h, w * (0.7 + rnd() * 0.6))),
          p.rockDark.clone().lerp(p.rock, 0.4 + rnd() * 0.4),
        );
      }
    }
  }

  // --- history: a wreck on the reef, a ruin on the high ground -------------
  if (arch !== ARCHETYPE_HOME && rnd() < 0.45) {
    const angle = rnd() * Math.PI * 2;
    const rc = terrain.shoreRadius(angle);
    // Straddling the waterline rather than beached: half-submerged is what
    // makes a wreck read as a wreck and not as cargo left on the sand.
    const r = rc * (0.95 + rnd() * 0.14);
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const size = Math.min(radius * (0.2 + rnd() * 0.14), 6.5);
    addWreck(b, new THREE.Vector3(x, Math.min(terrain.heightAt(x, z) * 0.4, 0.1), z), angle + Math.PI / 2 + rnd(), size, rnd);
  }

  if (arch !== ARCHETYPE_HOME && arch !== ARCHETYPE_CAY && rnd() < 0.42) {
    const spot = findSpot(p.height * 0.35, p.height * 1.1, 0.6, 0.1, 0.7);
    if (spot) addRuin(b, spot, Math.max(2.2, radius * 0.14), rnd);
  }

  // --- home port -----------------------------------------------------------
  if (arch === ARCHETYPE_HOME) {
    // Dock reaches seaward on the bearing of the player's spawn (+z), so a
    // returning captain sails straight at it.
    const dockDir = Math.PI / 2;
    const rc = terrain.shoreRadius(dockDir);
    addDock(
      b,
      new THREE.Vector3(Math.cos(dockDir) * rc * 0.82, 0, Math.sin(dockDir) * rc * 0.82),
      dockDir,
      radius * 0.5,
      rnd,
    );

    const hutCount = 6;
    for (let i = 0; i < hutCount; i++) {
      const spot = findSpot(p.sandLine, p.height * 0.85, 0.4, 0.3, 0.85);
      if (!spot) continue;
      addHut(b, spot, 1.5 + rnd() * 0.9, rnd() * Math.PI * 2);
    }

    // Flagpole on the summit.
    const summit = terrain.heightAt(0, 0);
    _v.set(0, summit + 3.2, 0);
    b.add(unitCylinder(), place(_v, 0, new THREE.Vector3(0.16, 6.4, 0.16)), new THREE.Color(0x4a3018));
    _v.set(1.05, summit + 5.6, 0);
    b.add(unitBox(), place(_v, 0, new THREE.Vector3(2.0, 1.2, 0.08)), new THREE.Color(0xc8352f));
  }

  if (b.isEmpty) return null;
  const mesh = new THREE.Mesh(b.build(), sharedPropsMaterial());
  // Palms throwing shadows across their own beach is a big part of what makes
  // an island look inhabited rather than pasted on; one extra shadow-pass
  // draw per island buys all of it.
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
