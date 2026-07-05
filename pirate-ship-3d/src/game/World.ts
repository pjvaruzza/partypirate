import * as THREE from 'three';
import { specklTexture, woodGrainTexture } from './Textures';

export interface Island {
  position: THREE.Vector3;
  radius: number;
  isHomePort: boolean;
  mesh: THREE.Group;
}

export interface GoldCrate {
  position: THREE.Vector3;
  mesh: THREE.Mesh;
  collected: boolean;
  value: number;
}

/** Sand near the waterline, grading through rock, up to grass at the summit. */
function heightGradientColor(t: number, isHomePort: boolean): THREE.Color {
  const sand = new THREE.Color(0xd9c48f);
  const rock = new THREE.Color(0x8a7a52);
  const grass = new THREE.Color(isHomePort ? 0x4a9a45 : 0x3f7d3a);
  if (t < 0.3) return sand.clone().lerp(rock, t / 0.3);
  return rock.clone().lerp(grass, Math.min(1, (t - 0.3) / 0.5));
}

/** A hemisphere with a noise-wobbled rim and a sand/rock/grass vertex-color
 * gradient — reads as a rounded, slightly rugged hill instead of a perfect
 * cone. Geometry radius stays 1 unit tall (y in [0, hillRadius]); the mesh is
 * then y-scaled to the desired height. */
function buildHillMesh(hillRadius: number, hillHeight: number, baseY: number, isHomePort: boolean): THREE.Mesh {
  const geo = new THREE.SphereGeometry(hillRadius, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colorArr = new Float32Array(pos.count * 3);
  const seedA = Math.random() * Math.PI * 2;
  const seedB = Math.random() * Math.PI * 2;
  const seedC = Math.random() * Math.PI * 2;
  const color = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const angle = Math.atan2(z, x);
    const t = THREE.MathUtils.clamp(y / hillRadius, 0, 1);

    const wobble =
      0.1 * Math.sin(angle * 3 + seedA) + 0.06 * Math.sin(angle * 5 + seedB) + 0.035 * Math.sin(angle * 9 + seedC);
    const scaleXZ = 1 + wobble * (1 - t * 0.6);
    pos.setX(i, x * scaleXZ);
    pos.setZ(i, z * scaleXZ);

    color.copy(heightGradientColor(t, isHomePort)).multiplyScalar(0.9 + Math.random() * 0.2);
    color.toArray(colorArr, i * 3);
  }
  pos.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: specklTexture(), roughness: 0.95 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.y = hillHeight / hillRadius;
  mesh.position.y = baseY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A squat, mostly-submerged cone that widens toward the waterline, giving
 * the hill a sandy shore instead of plunging straight into the sea. */
function buildBeachShelf(topRadius: number, bottomRadius: number, shelfHeight: number, topY: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(topRadius, bottomRadius, shelfHeight, 20);
  const mat = new THREE.MeshStandardMaterial({ color: 0xdcc793, roughness: 1, map: specklTexture() });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = topY - shelfHeight / 2;
  mesh.receiveShadow = true;
  return mesh;
}

function buildIsland(radius: number, isHomePort: boolean): THREE.Group {
  const group = new THREE.Group();

  const hillRadius = radius * 0.85;
  const shelfHeight = radius * 0.35;
  const beachTopY = shelfHeight * 0.4;
  group.add(buildBeachShelf(hillRadius, radius * 1.15, shelfHeight, beachTopY));

  const hillHeight = radius * (isHomePort ? 0.7 : 0.85);
  group.add(buildHillMesh(hillRadius, hillHeight, beachTopY, isHomePort));
  const summitY = beachTopY + hillHeight;

  /** Y coordinate of the hill's surface at a given horizontal distance from its axis. */
  function surfaceY(distFromCenter: number): number {
    const ratio = Math.min(0.98, distFromCenter / hillRadius);
    const localY = hillRadius * Math.sqrt(Math.max(0, 1 - ratio * ratio));
    return beachTopY + localY * (hillHeight / hillRadius);
  }

  if (isHomePort) {
    const flagPoleGeo = new THREE.CylinderGeometry(0.15, 0.15, 6, 12);
    const flagPole = new THREE.Mesh(flagPoleGeo, new THREE.MeshStandardMaterial({ color: 0x3a2410 }));
    flagPole.position.y = summitY + 3;
    group.add(flagPole);

    const flagGeo = new THREE.PlaneGeometry(2, 1.2);
    const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: 0xd63b3b, side: THREE.DoubleSide }));
    flag.position.set(1, summitY + 5.5, 0);
    group.add(flag);

    for (let i = 0; i < 4; i++) {
      const hutGeo = new THREE.BoxGeometry(1, 1, 1);
      const hut = new THREE.Mesh(hutGeo, new THREE.MeshStandardMaterial({ color: 0x9c6b3f, map: woodGrainTexture() }));
      const angle = (i / 4) * Math.PI * 2;
      const dist = radius * 0.5;
      hut.position.set(Math.cos(angle) * dist, surfaceY(dist) + 0.5, Math.sin(angle) * dist);
      group.add(hut);
    }
  } else {
    const palmCount = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < palmCount; i++) {
      const scale = 0.75 + Math.random() * 0.5;
      const angle = (i / palmCount) * Math.PI * 2 + Math.random() * 0.8;
      const dist = radius * (0.2 + Math.random() * 0.35);
      const py = surfaceY(dist);

      const palmTrunkGeo = new THREE.CylinderGeometry(0.08 * scale, 0.12 * scale, 1.8 * scale, 10);
      const palmTrunk = new THREE.Mesh(palmTrunkGeo, new THREE.MeshStandardMaterial({ color: 0x6b4423 }));
      palmTrunk.position.set(Math.cos(angle) * dist, py + 0.9 * scale, Math.sin(angle) * dist);
      palmTrunk.rotation.y = Math.random() * Math.PI * 2;
      group.add(palmTrunk);

      const leavesGeo = new THREE.SphereGeometry(0.5 * scale, 10, 8);
      const leaves = new THREE.Mesh(leavesGeo, new THREE.MeshStandardMaterial({ color: 0x2f8f3d }));
      leaves.position.set(palmTrunk.position.x, palmTrunk.position.y + scale, palmTrunk.position.z);
      leaves.scale.set(1, 0.6, 1);
      group.add(leaves);
    }

    const rockCount = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < rockCount; i++) {
      const rockScale = 0.3 + Math.random() * 0.35;
      const angle = Math.random() * Math.PI * 2;
      const dist = radius * (0.55 + Math.random() * 0.35);
      const py = surfaceY(dist);

      const rockGeo = new THREE.IcosahedronGeometry(rockScale, 0);
      const rock = new THREE.Mesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x746a5c, roughness: 1 }));
      rock.position.set(Math.cos(angle) * dist, py + rockScale * 0.4, Math.sin(angle) * dist);
      rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      group.add(rock);
    }
  }

  return group;
}

function buildCrate(): THREE.Mesh {
  const geo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.5, metalness: 0.3 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

export class World {
  islands: Island[] = [];
  crates: GoldCrate[] = [];
  homePort: Island;

  private scene: THREE.Scene;

  constructor(scene: THREE.Scene, islandCount = 10, worldRadius = 900) {
    this.scene = scene;
    const homeMesh = buildIsland(22, true);
    this.homePort = {
      position: new THREE.Vector3(0, 0, 0),
      radius: 22,
      isHomePort: true,
      mesh: homeMesh,
    };
    homeMesh.position.copy(this.homePort.position);
    scene.add(homeMesh);
    this.islands.push(this.homePort);

    for (let i = 0; i < islandCount; i++) {
      const angle = (i / islandCount) * Math.PI * 2 + Math.random() * 0.5;
      const dist = 150 + Math.random() * (worldRadius - 150);
      const pos = new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
      const radius = 12 + Math.random() * 20;
      const mesh = buildIsland(radius, false);
      mesh.position.copy(pos);
      scene.add(mesh);
      this.islands.push({ position: pos, radius, isHomePort: false, mesh });
    }

    this.spawnCrates(18, worldRadius);
  }

  private spawnCrates(count: number, worldRadius: number) {
    for (let i = 0; i < count; i++) this.spawnOneCrate(worldRadius);
  }

  spawnOneCrate(worldRadius = 900) {
    let pos: THREE.Vector3;
    let attempts = 0;
    do {
      const angle = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * (worldRadius - 40);
      pos = new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
      attempts++;
    } while (this.islands.some((isl) => isl.position.distanceTo(pos) < isl.radius + 8) && attempts < 20);

    const mesh = buildCrate();
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.crates.push({ position: pos, mesh, collected: false, value: 10 + Math.floor(Math.random() * 20) });
  }

  update(time: number, getWaveHeight: (x: number, z: number) => number) {
    for (const crate of this.crates) {
      if (crate.collected) continue;
      const h = getWaveHeight(crate.position.x, crate.position.z);
      crate.mesh.position.y = h + 0.3;
      crate.mesh.rotation.y = time * 0.6;
    }
  }

  collectCrate(crate: GoldCrate) {
    crate.collected = true;
    this.scene.remove(crate.mesh);
  }

  distanceToNearestLandCollision(pos: THREE.Vector3, margin: number): number {
    let closest = Infinity;
    for (const isl of this.islands) {
      const d = isl.position.distanceTo(pos) - isl.radius - margin;
      if (d < closest) closest = d;
    }
    return closest;
  }

  isNearHomePort(pos: THREE.Vector3, extra = 15): boolean {
    return this.homePort.position.distanceTo(pos) < this.homePort.radius + extra;
  }
}
