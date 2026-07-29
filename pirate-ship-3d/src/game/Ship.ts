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
const HULL_HALF_LENGTH = 2.0;
const HULL_MAX_BEAM = 0.85;
const HULL_DRAFT = 0.42;
const HULL_FREEBOARD = 0.5;
const DECK_CAMBER = 0.07;
/** y=0 in hull-local space is the designed waterline, so the group sits just
 * below the wave surface and the hull is actually *in* the water rather than
 * perched on it showing its keel. */
const WATERLINE_OFFSET = -0.3;

/** Half-beam multiplier along the hull; t=0 at the stern, 1 at the bow.
 * Full amidships, fine entry at the bow, moderately full transom. */
function beamProfile(t: number): number {
  const peak = 0.42;
  if (t <= peak) return 0.62 + 0.38 * Math.sin((t / peak) * Math.PI * 0.5);
  const u = (t - peak) / (1 - peak);
  return Math.max(0.03, Math.pow(Math.cos(u * Math.PI * 0.5), 0.8));
}

/** Deck-edge height — the classic sheer curve, lowest amidships, sweeping up
 * toward bow and stern. This single curve is most of what makes a hull read
 * as a ship rather than a box. */
function sheerProfile(t: number): number {
  const m = (t - 0.45) / 0.55;
  return HULL_FREEBOARD * (1 + 0.5 * m * m);
}

/** Keel line, with rocker so the bottom rises toward both ends. */
function keelProfile(t: number): number {
  const m = (t - 0.45) / 0.55;
  return -HULL_DRAFT * Math.max(0.18, 1 - 0.55 * m * m);
}

/** A lofted hull: cross-section "stations" swept from stern to bow, each a
 * rounded-bilge curve running keel → deck edge. Replaces a tapered
 * BoxGeometry, which read as a wedge no matter how well it was shaded. */
function buildLoftedHullGeometry(scale: number): THREE.BufferGeometry {
  const STATIONS = 32;
  const GIRTH = 16;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= STATIONS; i++) {
    const t = i / STATIONS;
    const z = (t - 0.5) * 2 * HULL_HALF_LENGTH * scale;
    const beam = beamProfile(t) * HULL_MAX_BEAM * scale;
    const keelY = keelProfile(t) * scale;
    const sheerY = sheerProfile(t) * scale;

    for (let j = 0; j <= GIRTH; j++) {
      const g = j / GIRTH;
      const s = g * 2 - 1; // -1 port … +1 starboard
      const v = Math.abs(s); // 0 at the keel, 1 at the deck edge
      const x = Math.sign(s) * beam * Math.pow(v, 0.5);
      const y = keelY + (sheerY - keelY) * v;
      positions.push(x, y, z);
      uvs.push(g, t);
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
  const sternKeel = keelProfile(0) * scale;
  const sternSheer = sheerProfile(0) * scale;
  const sternZ = -HULL_HALF_LENGTH * scale;
  const centroidIndex = positions.length / 3;
  positions.push(0, (sternKeel + sternSheer) * 0.5, sternZ);
  uvs.push(0.5, 0);
  for (let j = 0; j < GIRTH; j++) {
    indices.push(centroidIndex, j + 1, j);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** The deck surface closing the top of the hull, cambered so it crowns along
 * the centreline instead of reading as a flat lid. */
function buildDeckGeometry(scale: number): THREE.BufferGeometry {
  const STATIONS = 32;
  const SPAN = 10;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= STATIONS; i++) {
    const t = i / STATIONS;
    const z = (t - 0.5) * 2 * HULL_HALF_LENGTH * scale;
    const beam = beamProfile(t) * HULL_MAX_BEAM * scale;
    const sheerY = sheerProfile(t) * scale;
    for (let j = 0; j <= SPAN; j++) {
      const u = j / SPAN;
      const s = u * 2 - 1;
      positions.push(s * beam, sheerY + DECK_CAMBER * scale * (1 - s * s), z);
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

/** Gunwale rail swept along the actual sheer curve — straight box rails left
 * visible gaps once the hull stopped being a rectangular prism. */
function buildSheerRail(side: 1 | -1, scale: number): THREE.Mesh {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const beam = beamProfile(t) * HULL_MAX_BEAM * scale;
    points.push(
      new THREE.Vector3(
        side * beam * 0.985,
        sheerProfile(t) * scale + 0.055 * scale,
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

function buildHull(hullColor: number, sailColor: number, scale: number, masts: 1 | 2 = 1): THREE.Group {
  const group = new THREE.Group();

  const hullMat = new THREE.MeshStandardMaterial({ color: hullColor, roughness: 0.75, map: woodGrainTexture() });
  const hull = new THREE.Mesh(buildLoftedHullGeometry(scale), hullMat);
  hull.castShadow = true;
  hull.receiveShadow = true;
  hull.name = 'hull';
  group.add(hull);

  const deckMat = new THREE.MeshStandardMaterial({ color: 0x8a6437, roughness: 0.9, map: woodGrainTexture() });
  const deck = new THREE.Mesh(buildDeckGeometry(scale), deckMat);
  deck.receiveShadow = true;
  group.add(deck);

  const mastGeo = new THREE.CylinderGeometry(0.06 * scale, 0.08 * scale, 3.2 * scale, 16);
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21 });
  const mast = new THREE.Mesh(mastGeo, mastMat);
  mast.position.set(0, 2.1 * scale, -0.2 * scale);
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

  // --- gunwale trim, swept along the sheer curve -------------------------
  group.add(buildSheerRail(1, scale));
  group.add(buildSheerRail(-1, scale));

  // --- quarterdeck --------------------------------------------------------
  const quarterDeck = new THREE.Mesh(new THREE.BoxGeometry(1.0 * scale, 0.3 * scale, 1.0 * scale), deckMat);
  quarterDeck.position.set(0, 0.72 * scale, -1.3 * scale);
  quarterDeck.castShadow = true;
  group.add(quarterDeck);

  // --- bowsprit + jib -------------------------------------------------------
  const bowTip = new THREE.Vector3(0, 1.15 * scale, 3.15 * scale);
  const bowsprit = buildSpar(new THREE.Vector3(0, 0.75 * scale, 1.8 * scale), bowTip, 0.09 * scale, 0.04 * scale, 0x5c3a21);
  bowsprit.castShadow = true;
  group.add(bowsprit);

  const jib = buildTriangleSail(
    bowTip,
    new THREE.Vector3(0, 0.8 * scale, 0.1 * scale),
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
      new THREE.Vector3(0, sheerProfile(0.08) * scale, -1.75 * scale),
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
        new THREE.Vector3(side * beamProfile(0.32) * HULL_MAX_BEAM * scale, sheerProfile(0.32) * scale, -0.72 * scale),
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

function buildCannonsGroup(loadout: CannonLoadout, scale: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cannons';
  const mountY = 0.72 * scale;

  (['front', 'left', 'right'] as CannonSide[]).forEach((side) => {
    const offsets = cannonMountOffsets(side, loadout[side], scale);
    for (const offset of offsets) {
      const barrel = buildCannonBarrel(scale);
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

  constructor(
    stats: ShipStats,
    opts: { hullColor?: number; sailColor?: number; scale?: number; loadout?: CannonLoadout; masts?: 1 | 2 } = {},
  ) {
    this.stats = stats;
    this.scale = opts.scale ?? 1;
    this.loadout = opts.loadout ?? { ...DEFAULT_LOADOUT };
    this.maxHealth = 60 + stats.hullLevel * 40;
    this.health = this.maxHealth;
    this.group = buildHull(opts.hullColor ?? 0x6b4a2c, opts.sailColor ?? 0xe8e0cf, this.scale, opts.masts ?? 1);
    this.sailMesh = this.group.getObjectByName('sail') as THREE.Mesh;
    this.hullMesh = this.group.getObjectByName('hull') as THREE.Mesh;
    this.hullMat = this.hullMesh.material as THREE.MeshStandardMaterial;
    this.cannonsGroup = buildCannonsGroup(this.loadout, this.scale);
    this.group.add(this.cannonsGroup);
  }

  get topSpeed() {
    return 6 + this.stats.sailLevel * 2.2;
  }

  setLoadout(loadout: CannonLoadout) {
    this.loadout = { ...loadout };
    this.group.remove(this.cannonsGroup);
    disposeGroup(this.cannonsGroup);
    this.cannonsGroup = buildCannonsGroup(this.loadout, this.scale);
    this.group.add(this.cannonsGroup);
  }

  flashHit() {
    this.hitFlash = 1;
  }

  updateHitFlash(dt: number) {
    if (this.hitFlash <= 0) return;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    this.hullMat.emissive.setRGB(this.hitFlash, this.hitFlash * 0.85, this.hitFlash * 0.75);
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

  syncVisual(waveHeight: number, time: number) {
    if (this.sinking) {
      const t = this.sinkTimer / SINK_DURATION;
      const eased = t * t;
      this.group.position.set(this.position.x, waveHeight + WATERLINE_OFFSET - eased * 2.5, this.position.z);
      this.group.rotation.y = this.heading;
      this.group.rotation.z = this.sinkListDir * eased * 0.9;
      this.group.rotation.x = eased * 0.4;
      return;
    }
    this.group.position.set(this.position.x, waveHeight + WATERLINE_OFFSET, this.position.z);
    this.group.rotation.y = this.heading;
    const bob = Math.sin(time * 1.6 + this.bobPhase) * 0.05;
    this.group.rotation.z = bob;
    this.group.rotation.x = Math.sin(time * 1.3 + this.bobPhase) * 0.03;
    this.sailMesh.rotation.y = Math.min(Math.abs(this.speed) / this.topSpeed, 1) * 0.15;
  }

  forwardDirection(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
  }
}
