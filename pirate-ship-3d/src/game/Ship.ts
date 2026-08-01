import * as THREE from 'three';
import { woodGrainTexture, sailClothTexture } from './Textures';

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

/** A lofted hull: cross-section "stations" swept from stern to bow, each a
 * rounded-bilge curve running keel → deck edge. Replaces a tapered
 * BoxGeometry, which read as a wedge no matter how well it was shaded. */
function buildLoftedHullGeometry(scale: number, hullClass: HullClass): THREE.BufferGeometry {
  const STATIONS = 32;
  const GIRTH = 16;
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  // Boot-top: a dark antifouling bottom below the waterline and a narrow
  // near-black band straddling it. Without this the hull is one flat wood
  // tone from keel to rail, so nothing on the model itself says where the
  // water is meant to meet it — the eye has no waterline to read and defaults
  // to "this thing is stuck in the surface" rather than "floating on it".
  const bootColor = (yLocal: number): [number, number, number] => {
    const y = yLocal / scale; // back to hull-form units, where y=0 is the waterline
    const below = 1 - smooth(y, -0.05, 0.14); // 1 fully under, 0 fully above
    const band = Math.max(0, 1 - Math.abs(y - 0.02) / 0.09);
    const m = 1 - below * 0.5 - band * 0.28;
    // Antifouling reads slightly red-brown rather than just darker wood.
    return [m * 1.05, m * 0.9, m * 0.86];
  };

  for (let i = 0; i <= STATIONS; i++) {
    const t = i / STATIONS;
    const z = (t - 0.5) * 2 * HULL_HALF_LENGTH * scale;
    const beam = beamProfile(t, hullClass) * HULL_MAX_BEAM * scale;
    const keelY = keelProfile(t) * scale;
    const sheerY = sheerProfile(t, hullClass) * scale;

    for (let j = 0; j <= GIRTH; j++) {
      const g = j / GIRTH;
      const s = g * 2 - 1; // -1 port … +1 starboard
      const v = Math.abs(s); // 0 at the keel, 1 at the rail
      const x = Math.sign(s) * beam * sectionFullness(v);
      const y = keelY + (sheerY - keelY) * v;
      positions.push(x, y, z);
      uvs.push(g, t);
      colors.push(...bootColor(y));
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
  // BUG FIX: the fan used to cover only the U-shaped station ring (port rail →
  // keel → starboard rail) and stopped at the two spokes running from the
  // centroid out to each rail. Everything above those spokes — a wedge right
  // on the ship's centreline — was simply not there, and with the deck now
  // recessed inside a bulwark it was no longer covered up: from the chase
  // camera, dead astern, you could see the open sea straight through the back
  // of the ship. Fanning the rail-to-rail closing edge as well makes the
  // transom a genuinely closed panel.
  const sternKeel = keelProfile(0) * scale;
  const sternSheer = sheerProfile(0, hullClass) * scale;
  const sternZ = -HULL_HALF_LENGTH * scale;
  const centroidIndex = positions.length / 3;
  const centroidY = (sternKeel + sternSheer) * 0.5;
  positions.push(0, centroidY, sternZ);
  uvs.push(0.5, 0);
  colors.push(...bootColor(centroidY));
  for (let j = 0; j < GIRTH; j++) {
    indices.push(centroidIndex, j + 1, j);
  }
  indices.push(centroidIndex, 0, GIRTH);

  // Same closure at the stem. beamProfile(1) floors at 0.03 rather than 0, so
  // the bow station is a narrow-but-open sliver; without this you can see into
  // the hull along a hairline at the prow.
  const bowIndex = positions.length / 3;
  const bowY = (keelProfile(1) + sheerProfile(1, hullClass)) * 0.5 * scale;
  positions.push(0, bowY, HULL_HALF_LENGTH * scale);
  uvs.push(0.5, 1);
  colors.push(...bootColor(bowY));
  const bowRing = STATIONS * (GIRTH + 1);
  for (let j = 0; j < GIRTH; j++) {
    indices.push(bowIndex, bowRing + j, bowRing + j + 1);
  }
  indices.push(bowIndex, bowRing + GIRTH, bowRing);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Smoothstep, used by the boot-top ramp. */
function smooth(x: number, a: number, b: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The deck surface closing the top of the hull, cambered so it crowns along
 * the centreline instead of reading as a flat lid. */
function buildDeckGeometry(scale: number, hullClass: HullClass): THREE.BufferGeometry {
  const STATIONS = 32;
  const SPAN = 10;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= STATIONS; i++) {
    const t = i / STATIONS;
    const z = (t - 0.5) * 2 * HULL_HALF_LENGTH * scale;
    // The deck now sits BULWARK_HEIGHT below the rail, and the hull's
    // topsides flare outward, so the deck is narrower than the rail line —
    // build it to the hull's actual half-beam at deck level (same
    // `beam * v^0.5` law the loft uses) or it would poke through the sides.
    const beam = beamProfile(t, hullClass) * HULL_MAX_BEAM * scale * sectionFullness(deckV(t, hullClass));
    const deckY = deckProfile(t, hullClass) * scale;
    for (let j = 0; j <= SPAN; j++) {
      const u = j / SPAN;
      const s = u * 2 - 1;
      positions.push(s * beam, deckY + DECK_CAMBER * scale * (1 - s * s), z);
      uvs.push(u, t * 3);
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
 * Verified with a magenta-painted ocean that the sea *was* already clipping
 * the hull at the correct height — the hull just terminated against the water
 * with a hard, dry edge and no contact whatsoever, so nothing told the eye
 * whether the water was in front of the hull or behind it, and it read as a
 * boat-shaped object hovering over a painted sea.
 *
 * One extra transparent draw call per ship over a very small screen area;
 * depthWrite is off so it can't punch a hole in anything behind it. */
function buildFoamCollar(scale: number, hullClass: HullClass): THREE.Mesh {
  const STATIONS = 36;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  /** Half-beam where the hull's own surface crosses y = 0, i.e. the waterline
   * outline the foam has to trace. */
  const waterlineHalfBeam = (t: number) => {
    const keelY = keelProfile(t);
    const sheerY = sheerProfile(t, hullClass);
    const v0 = Math.min(1, Math.max(0, -keelY / (sheerY - keelY)));
    return beamProfile(t, hullClass) * HULL_MAX_BEAM * scale * sectionFullness(v0);
  };

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
    // Point the normal away from the hull's centre.
    if (nx * loop[k].x + nz * loop[k].z < 0) {
      nx = -nx;
      nz = -nz;
    }
    // A little wider forward (bow wave) and right astern (wake), narrower
    // along the flat of the side.
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
    }),
  );
  mesh.name = 'foam';
  mesh.renderOrder = 1;
  return mesh;
}

/** Gunwale rail swept along the actual sheer curve — straight box rails left
 * visible gaps once the hull stopped being a rectangular prism. */
function buildSheerRail(side: 1 | -1, scale: number, hullClass: HullClass): THREE.Mesh {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const beam = beamProfile(t, hullClass) * HULL_MAX_BEAM * scale;
    points.push(
      new THREE.Vector3(
        side * beam * 0.985,
        sheerProfile(t, hullClass) * scale + 0.055 * scale,
        (t - 0.5) * 2 * HULL_HALF_LENGTH * scale,
      ),
    );
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, 40, 0.055 * scale, 6, false);
  const mat = new THREE.MeshStandardMaterial({ color: 0x40291a, roughness: 0.7 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

/** A sail with an actual belly in it — a flat plane reads as cardboard. */
function buildBilloweSail(
  width: number,
  height: number,
  bulge: number,
  sailColor: number,
): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(width, height, 12, 12);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / width + 0.5;
    const v = pos.getY(i) / height + 0.5;
    pos.setZ(i, Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * bulge);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: sailColor,
    side: THREE.DoubleSide,
    // Fully rough, so the sail takes shading from the billow instead of
    // clipping to a flat blown-out white under the sun + ACES tonemap.
    roughness: 1,
    metalness: 0,
    map: sailClothTexture(),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

/** A cylinder stretched and oriented between two arbitrary points — used for
 * the bowsprit and the rigging lines. */
function buildSpar(from: THREE.Vector3, to: THREE.Vector3, radiusStart: number, radiusEnd: number, color: number): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(to, from);
  const length = dir.length();
  const geo = new THREE.CylinderGeometry(radiusEnd, radiusStart, length, 8);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color }));
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

/** A single flat triangular sail (the jib), since PlaneGeometry can't make
 * that shape. */
function buildTriangleSail(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: number): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z]), 3),
  );
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0]), 2));
  geo.setIndex([0, 1, 2]);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color,
    side: THREE.DoubleSide,
    roughness: 0.85,
    map: sailClothTexture(),
  });
  return new THREE.Mesh(geo, mat);
}

function buildHull(
  hullColor: number,
  sailColor: number,
  scale: number,
  masts: 1 | 2 = 1,
  hullClass: HullClass = 0,
): THREE.Group {
  const group = new THREE.Group();

  // DoubleSide because the deck is now recessed inside a bulwark: from the
  // chase camera you look at the *inner* face of the topsides, which is a
  // back face of the lofted shell. Front-face culling would let you see
  // straight through the hull to the ocean beyond. No extra geometry, and
  // the hull is small enough on screen that the overdraw is immaterial.
  const hullMat = new THREE.MeshStandardMaterial({
    color: hullColor,
    roughness: 0.75,
    map: woodGrainTexture(),
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  const hull = new THREE.Mesh(buildLoftedHullGeometry(scale, hullClass), hullMat);
  hull.castShadow = true;
  hull.receiveShadow = true;
  hull.name = 'hull';
  group.add(hull);

  const deckMat = new THREE.MeshStandardMaterial({ color: 0x8a6437, roughness: 0.9, map: woodGrainTexture() });
  const deck = new THREE.Mesh(buildDeckGeometry(scale, hullClass), deckMat);
  deck.receiveShadow = true;
  group.add(deck);

  // Stepped on the (now lower, recessed) deck rather than left hanging above
  // it — same masthead height as before, just a longer heel.
  const mastGeo = new THREE.CylinderGeometry(0.06 * scale, 0.08 * scale, 3.4 * scale, 16);
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21 });
  const mast = new THREE.Mesh(mastGeo, mastMat);
  mast.position.set(0, 2.0 * scale, -0.2 * scale);
  mast.castShadow = true;
  group.add(mast);

  const sail = buildBilloweSail(1.4 * scale, 2.2 * scale, 0.3 * scale, sailColor);
  sail.position.set(0, 2.2 * scale, -0.19 * scale);
  sail.name = 'sail';
  group.add(sail);

  // A yard across the head of the mainsail — sails don't hang off nothing.
  const yard = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035 * scale, 0.035 * scale, 1.7 * scale, 8),
    mastMat,
  );
  yard.rotation.z = Math.PI / 2;
  yard.position.set(0, 3.3 * scale, -0.2 * scale);
  yard.castShadow = true;
  group.add(yard);

  // Bigger classes carry a foremast — previously brigantines and galleons
  // were just a sloop scaled up, so class was only readable as size.
  if (masts === 2) {
    const foreMast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05 * scale, 0.07 * scale, 2.5 * scale, 16),
      mastMat,
    );
    foreMast.position.set(0, 1.75 * scale, 1.05 * scale);
    foreMast.castShadow = true;
    group.add(foreMast);

    const foreSail = buildBilloweSail(1.05 * scale, 1.6 * scale, 0.22 * scale, sailColor);
    foreSail.position.set(0, 1.85 * scale, 1.06 * scale);
    group.add(foreSail);

    const foreYard = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03 * scale, 0.03 * scale, 1.3 * scale, 8),
      mastMat,
    );
    foreYard.rotation.z = Math.PI / 2;
    foreYard.position.set(0, 2.65 * scale, 1.05 * scale);
    foreYard.castShadow = true;
    group.add(foreYard);
  }

  const flagGeo = new THREE.ConeGeometry(0.15 * scale, 0.4 * scale, 4);
  const flagMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const flag = new THREE.Mesh(flagGeo, flagMat);
  flag.rotation.z = Math.PI / 2;
  flag.position.set(0, 3.75 * scale, -0.2 * scale);
  group.add(flag);

  group.add(buildFoamCollar(scale, hullClass));

  // --- gunwale trim, swept along the sheer curve -------------------------
  group.add(buildSheerRail(1, scale, hullClass));
  group.add(buildSheerRail(-1, scale, hullClass));

  // --- quarterdeck, plus a stepped sterncastle for the bigger classes -----
  // Anchored to the actual (class-boosted) deck height at the stern so it
  // sits on the deck instead of floating or clipping through it once the
  // stern got taller. The hull's stern is a raked, curved surface that
  // tapers to a point at the transom (see buildLoftedHullGeometry's fan
  // closure) — a flat-bottomed box can't match that exactly, so each tier
  // is built EMBED deeper than its nominal footing and stacked from there,
  // guaranteeing overlap with solid geometry instead of a visible gap.
  const EMBED = 0.12 * scale;
  const quarterDeckTopY = sheerProfile(0.15, hullClass) * scale + 0.3 * scale;
  // Reaches down to the *deck*, not the rail, now that they're different
  // heights — otherwise the box would float clear of the deck by the bulwark
  // height, or vanish behind it entirely.
  const quarterDeckHeight = (0.3 + BULWARK_HEIGHT) * scale + EMBED;
  const quarterDeck = new THREE.Mesh(
    new THREE.BoxGeometry(0.86 * scale * beamFullnessMult(hullClass), quarterDeckHeight, 1.0 * scale),
    deckMat,
  );
  quarterDeck.position.set(0, quarterDeckTopY - quarterDeckHeight / 2, -1.3 * scale);
  quarterDeck.castShadow = true;
  group.add(quarterDeck);

  if (hullClass >= 1) {
    const tierHeight = (hullClass === 1 ? 0.35 : 0.55) * scale;
    const tierWidth = 0.75 * scale * (hullClass === 1 ? 1 : 1.08);
    const tierTopY = quarterDeckTopY + tierHeight;
    const tierTotalHeight = tierHeight + EMBED;
    const sternCastle = new THREE.Mesh(new THREE.BoxGeometry(tierWidth, tierTotalHeight, 0.85 * scale), deckMat);
    sternCastle.position.set(0, tierTopY - tierTotalHeight / 2, -1.5 * scale);
    sternCastle.castShadow = true;
    group.add(sternCastle);

    if (hullClass === 2) {
      // A third, smaller tier — a proper stepped castle instead of one block.
      const topHeight = 0.28 * scale;
      const topTopY = tierTopY + topHeight;
      const topTotalHeight = topHeight + EMBED;
      const topTier = new THREE.Mesh(new THREE.BoxGeometry(0.5 * scale, topTotalHeight, 0.55 * scale), deckMat);
      topTier.position.set(0, topTopY - topTotalHeight / 2, -1.6 * scale);
      topTier.castShadow = true;
      group.add(topTier);
    }
  }

  // --- bowsprit + jib -------------------------------------------------------
  // Springs from the stem head (the rail at the bow), which is a good deal
  // higher than it used to be, and keeps roughly the old rake.
  const stemHeadY = sheerProfile(0.95, hullClass) * scale;
  const bowTip = new THREE.Vector3(0, stemHeadY + 0.42 * scale, 3.15 * scale);
  const bowsprit = buildSpar(new THREE.Vector3(0, stemHeadY, 1.8 * scale), bowTip, 0.09 * scale, 0.04 * scale, 0x5c3a21);
  bowsprit.castShadow = true;
  group.add(bowsprit);

  const jib = buildTriangleSail(
    bowTip,
    new THREE.Vector3(0, deckProfile(0.55, hullClass) * scale + 0.35 * scale, 0.2 * scale),
    new THREE.Vector3(0, 2.35 * scale, -0.2 * scale),
    sailColor,
  );
  jib.name = 'jib';
  group.add(jib);

  // --- rigging --------------------------------------------------------------
  const mastTop = new THREE.Vector3(0, 3.55 * scale, -0.2 * scale);
  const ropeColor = 0x2a2018;
  group.add(buildSpar(mastTop, bowTip, 0.015 * scale, 0.015 * scale, ropeColor));
  group.add(
    buildSpar(
      mastTop,
      // Lands on top of the quarterdeck rather than inside it.
      new THREE.Vector3(0, quarterDeckTopY, -1.75 * scale),
      0.015 * scale,
      0.015 * scale,
      ropeColor,
    ),
  );

  // Shrouds from the masthead down and *aft* to the deck edges, port and
  // starboard — running them to midships put them straight across the face
  // of the sail.
  for (const side of [1, -1]) {
    group.add(
      buildSpar(
        mastTop,
        new THREE.Vector3(
          side * beamProfile(0.32, hullClass) * HULL_MAX_BEAM * scale,
          sheerProfile(0.32, hullClass) * scale,
          -0.72 * scale,
        ),
        0.012 * scale,
        0.012 * scale,
        ropeColor,
      ),
    );
  }

  return group;
}

function buildCannonBarrel(scale: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(0.07 * scale, 0.09 * scale, 0.55 * scale, 16);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.4, roughness: 0.6 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

function buildCannonsGroup(loadout: CannonLoadout, scale: number, hullClass: HullClass): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cannons';

  (['front', 'left', 'right'] as CannonSide[]).forEach((side) => {
    const offsets = cannonMountOffsets(side, loadout[side], scale);
    for (const offset of offsets) {
      const barrel = buildCannonBarrel(scale);
      // Run out through the bulwark at each gun's own station rather than all
      // at one flat height — with the sheer sweeping up toward the ends, a
      // constant Y put the forward guns below the deck and the waist guns
      // above the rail. Sits ~40% of the way up the bulwark, i.e. muzzle
      // level with a gunport.
      const t = offset.z / (2 * HULL_HALF_LENGTH * scale) + 0.5;
      const mountY = deckProfile(t, hullClass) * scale + 0.14 * scale;
      barrel.position.set(offset.x, mountY, offset.z);
      if (side === 'front') {
        barrel.rotation.x = Math.PI / 2;
        barrel.position.z += 0.3 * scale;
      } else {
        barrel.rotation.z = Math.PI / 2;
        barrel.position.x += (side === 'left' ? -0.25 : 0.25) * scale;
      }
      group.add(barrel);
    }
  });

  return group;
}

function disposeGroup(group: THREE.Group) {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material.dispose();
    }
  });
}

const SINK_DURATION = 2.2;

export class Ship {
  readonly group: THREE.Group;
  readonly scale: number;
  private sailMesh: THREE.Mesh;
  private hullMesh: THREE.Mesh;
  private hullMat: THREE.MeshStandardMaterial;
  private cannonsGroup: THREE.Group;

  position = new THREE.Vector3();
  heading = 0; // radians, 0 = facing -Z
  speed = 0;
  health: number;
  maxHealth: number;
  alive = true;

  stats: ShipStats;
  loadout: CannonLoadout;
  private bobPhase = Math.random() * Math.PI * 2;
  private hitFlash = 0;
  private sinking = false;
  private sinkTimer = 0;
  private sinkListDir = 1;
  private sailMat: THREE.MeshStandardMaterial;
  private foamMat!: THREE.MeshBasicMaterial;
  private baseSailColor: THREE.Color;
  private burning = false;
  private sailDisabled = false;
  private readonly hullClass: HullClass;

  constructor(
    stats: ShipStats,
    opts: {
      hullColor?: number;
      sailColor?: number;
      scale?: number;
      loadout?: CannonLoadout;
      masts?: 1 | 2;
      hullClass?: HullClass;
    } = {},
  ) {
    this.stats = stats;
    this.scale = opts.scale ?? 1;
    this.loadout = opts.loadout ?? { ...DEFAULT_LOADOUT };
    this.maxHealth = 60 + stats.hullLevel * 40;
    this.health = this.maxHealth;
    this.hullClass = opts.hullClass ?? 0;
    this.group = buildHull(
      opts.hullColor ?? 0x6b4a2c,
      opts.sailColor ?? 0xe8e0cf,
      this.scale,
      opts.masts ?? 1,
      this.hullClass,
    );
    this.sailMesh = this.group.getObjectByName('sail') as THREE.Mesh;
    this.hullMesh = this.group.getObjectByName('hull') as THREE.Mesh;
    this.hullMat = this.hullMesh.material as THREE.MeshStandardMaterial;
    this.foamMat = (this.group.getObjectByName('foam') as THREE.Mesh).material as THREE.MeshBasicMaterial;
    this.sailMat = this.sailMesh.material as THREE.MeshStandardMaterial;
    this.baseSailColor = this.sailMat.color.clone();
    this.cannonsGroup = buildCannonsGroup(this.loadout, this.scale, this.hullClass);
    this.group.add(this.cannonsGroup);
  }

  get topSpeed() {
    return 6 + this.stats.sailLevel * 2.2;
  }

  setLoadout(loadout: CannonLoadout) {
    this.loadout = { ...loadout };
    this.group.remove(this.cannonsGroup);
    disposeGroup(this.cannonsGroup);
    this.cannonsGroup = buildCannonsGroup(this.loadout, this.scale, this.hullClass);
    this.group.add(this.cannonsGroup);
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
      this.sailMat.color.copy(sailDisabled ? new THREE.Color(0x8a8378) : this.baseSailColor);
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

  /**
   * @param waveHeight wave height at the ship's own x/z
   * @param waveAt optional sampler for wave height at an arbitrary x/z. When
   *   supplied the hull rides the chord between its bow and stern instead of
   *   sitting flat at its centre height. This matters more than it sounds: the
   *   ocean's three swells sum to ±1.65 world units, and across a 4-unit hull
   *   the surface can differ by up to ~0.27 units end to end — which used to
   *   be over half of the entire 0.50 freeboard, so on a passing crest the
   *   water genuinely rose over the gunwale amidships or at one end. Riding
   *   the chord drops that residual to under 0.05. Reused, not allocated.
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
      // A sunk hull is under the surface; its waterline foam has to go with it.
      this.foamMat.opacity = Math.max(0, 0.6 * (1 - t * 3));
      return;
    }
    this.group.position.set(this.position.x, baseY, this.position.z);
    this.group.rotation.y = this.heading;
    const bob = Math.sin(time * 1.6 + this.bobPhase) * 0.05;
    this.group.rotation.z = bob;
    this.group.rotation.x = pitch + Math.sin(time * 1.3 + this.bobPhase) * 0.02;
    const speedFrac = Math.min(Math.abs(this.speed) / this.topSpeed, 1);
    this.sailMesh.rotation.y = speedFrac * 0.15;
    // Never zero — a hove-to ship still has a wet waterline — but a moving
    // one throws noticeably more. Cheap scalar write, no allocation.
    this.foamMat.opacity = 0.42 + speedFrac * 0.5 + Math.sin(time * 3.1 + this.bobPhase) * 0.05;
  }

  forwardDirection(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
  }
}
