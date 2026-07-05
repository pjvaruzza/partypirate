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

function buildHull(hullColor: number, sailColor: number, scale: number): THREE.Group {
  const group = new THREE.Group();

  const hullGeo = new THREE.BoxGeometry(1.6 * scale, 0.7 * scale, 4 * scale);
  // taper the bow/stern by skewing a few vertices for a boat-ish silhouette
  const pos = hullGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    if (z > 1.6 * scale) pos.setX(i, x * 0.25);
    else if (z < -1.6 * scale) pos.setX(i, x * 0.55);
  }
  pos.needsUpdate = true;
  hullGeo.computeVertexNormals();

  const hullMat = new THREE.MeshStandardMaterial({ color: hullColor, roughness: 0.75, map: woodGrainTexture() });
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.position.y = 0.35 * scale;
  hull.castShadow = true;
  hull.name = 'hull';
  group.add(hull);

  const deckGeo = new THREE.BoxGeometry(1.3 * scale, 0.1 * scale, 3.4 * scale);
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x8a6437, roughness: 0.9, map: woodGrainTexture() });
  const deck = new THREE.Mesh(deckGeo, deckMat);
  deck.position.y = 0.75 * scale;
  group.add(deck);

  const mastGeo = new THREE.CylinderGeometry(0.06 * scale, 0.08 * scale, 3.2 * scale, 16);
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21 });
  const mast = new THREE.Mesh(mastGeo, mastMat);
  mast.position.set(0, 2.1 * scale, -0.2 * scale);
  mast.castShadow = true;
  group.add(mast);

  const sailGeo = new THREE.PlaneGeometry(1.4 * scale, 2.2 * scale, 4, 4);
  const sailMat = new THREE.MeshStandardMaterial({
    color: sailColor,
    side: THREE.DoubleSide,
    roughness: 0.85,
    map: sailClothTexture(),
  });
  const sail = new THREE.Mesh(sailGeo, sailMat);
  sail.position.set(0, 2.2 * scale, -0.19 * scale);
  sail.name = 'sail';
  group.add(sail);

  const flagGeo = new THREE.ConeGeometry(0.15 * scale, 0.4 * scale, 4);
  const flagMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const flag = new THREE.Mesh(flagGeo, flagMat);
  flag.rotation.z = Math.PI / 2;
  flag.position.set(0, 3.75 * scale, -0.2 * scale);
  group.add(flag);

  // --- gunwale trim -----------------------------------------------------
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x40291a, roughness: 0.7 });
  const railY = 0.91 * scale;
  const leftRail = new THREE.Mesh(new THREE.BoxGeometry(0.08 * scale, 0.22 * scale, 3.6 * scale), trimMat);
  leftRail.position.set(0.62 * scale, railY, 0);
  group.add(leftRail);
  const rightRail = new THREE.Mesh(new THREE.BoxGeometry(0.08 * scale, 0.22 * scale, 3.6 * scale), trimMat);
  rightRail.position.set(-0.62 * scale, railY, 0);
  group.add(rightRail);
  const sternRail = new THREE.Mesh(new THREE.BoxGeometry(1.2 * scale, 0.22 * scale, 0.08 * scale), trimMat);
  sternRail.position.set(0, railY, -1.65 * scale);
  group.add(sternRail);

  // --- quarterdeck --------------------------------------------------------
  const quarterDeck = new THREE.Mesh(new THREE.BoxGeometry(1.0 * scale, 0.3 * scale, 1.0 * scale), deckMat);
  quarterDeck.position.set(0, 0.95 * scale, -1.3 * scale);
  quarterDeck.castShadow = true;
  group.add(quarterDeck);

  // --- bowsprit + jib -------------------------------------------------------
  const bowTip = new THREE.Vector3(0, 1.0 * scale, 3.15 * scale);
  const bowsprit = buildSpar(new THREE.Vector3(0, 0.55 * scale, 1.85 * scale), bowTip, 0.09 * scale, 0.04 * scale, 0x5c3a21);
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
  group.add(buildSpar(mastTop, new THREE.Vector3(0, railY, -1.65 * scale), 0.015 * scale, 0.015 * scale, ropeColor));

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
    opts: { hullColor?: number; sailColor?: number; scale?: number; loadout?: CannonLoadout } = {},
  ) {
    this.stats = stats;
    this.scale = opts.scale ?? 1;
    this.loadout = opts.loadout ?? { ...DEFAULT_LOADOUT };
    this.maxHealth = 60 + stats.hullLevel * 40;
    this.health = this.maxHealth;
    this.group = buildHull(opts.hullColor ?? 0x6b4a2c, opts.sailColor ?? 0xe8e0cf, this.scale);
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
      this.group.position.set(this.position.x, waveHeight + 0.15 - eased * 2.5, this.position.z);
      this.group.rotation.y = this.heading;
      this.group.rotation.z = this.sinkListDir * eased * 0.9;
      this.group.rotation.x = eased * 0.4;
      return;
    }
    this.group.position.set(this.position.x, waveHeight + 0.15, this.position.z);
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
