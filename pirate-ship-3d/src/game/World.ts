import * as THREE from 'three';

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

function buildIsland(radius: number, isHomePort: boolean): THREE.Group {
  const group = new THREE.Group();
  const height = radius * 0.6;

  const baseGeo = new THREE.ConeGeometry(radius, height, 8);
  const baseMat = new THREE.MeshStandardMaterial({
    color: isHomePort ? 0x8a7a52 : 0xc2b280,
    roughness: 1,
  });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = height / 2 - 0.4;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const capGeo = new THREE.ConeGeometry(radius * 0.55, height * 0.5, 8);
  const capMat = new THREE.MeshStandardMaterial({ color: 0x3f7d3a, roughness: 0.95 });
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.position.y = height - 0.4;
  group.add(cap);

  if (isHomePort) {
    const flagPoleGeo = new THREE.CylinderGeometry(0.15, 0.15, 6, 6);
    const flagPole = new THREE.Mesh(flagPoleGeo, new THREE.MeshStandardMaterial({ color: 0x3a2410 }));
    flagPole.position.y = height + 2.5;
    group.add(flagPole);

    const flagGeo = new THREE.PlaneGeometry(2, 1.2);
    const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: 0xd63b3b, side: THREE.DoubleSide }));
    flag.position.set(1, height + 5, 0);
    group.add(flag);

    for (let i = 0; i < 4; i++) {
      const hutGeo = new THREE.BoxGeometry(1, 1, 1);
      const hut = new THREE.Mesh(hutGeo, new THREE.MeshStandardMaterial({ color: 0x9c6b3f }));
      const angle = (i / 4) * Math.PI * 2;
      hut.position.set(Math.cos(angle) * radius * 0.5, 0.9, Math.sin(angle) * radius * 0.5);
      group.add(hut);
    }
  } else {
    for (let i = 0; i < 3; i++) {
      const palmTrunkGeo = new THREE.CylinderGeometry(0.08, 0.12, 1.8, 6);
      const palmTrunk = new THREE.Mesh(palmTrunkGeo, new THREE.MeshStandardMaterial({ color: 0x6b4423 }));
      const angle = (i / 3) * Math.PI * 2 + Math.random();
      const dist = radius * (0.3 + Math.random() * 0.3);
      palmTrunk.position.set(Math.cos(angle) * dist, height - 0.2, Math.sin(angle) * dist);
      group.add(palmTrunk);

      const leavesGeo = new THREE.SphereGeometry(0.5, 6, 6);
      const leaves = new THREE.Mesh(leavesGeo, new THREE.MeshStandardMaterial({ color: 0x2f8f3d }));
      leaves.position.set(palmTrunk.position.x, palmTrunk.position.y + 1, palmTrunk.position.z);
      leaves.scale.set(1, 0.6, 1);
      group.add(leaves);
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
