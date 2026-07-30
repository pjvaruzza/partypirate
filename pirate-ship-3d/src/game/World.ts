import * as THREE from 'three';
import { specklTexture, woodGrainTexture } from './Textures';
import type { IslandInfo } from '../shared/protocol';

export interface Island {
  position: THREE.Vector3;
  radius: number;
  isHomePort: boolean;
  mesh: THREE.Group;
}

/** Sand near the waterline, grading through rock, up to grass — then, above
 * `capMix > 0`, back to bare rock near the summit. Without that last step
 * the whole top ~20% of every hill was one flat, uniform green, since the
 * grass/rock lerp already saturates well before t=1. */
function heightGradientColor(t: number, isHomePort: boolean, capMix: number): THREE.Color {
  const sand = new THREE.Color(0xd9c48f);
  const rock = new THREE.Color(0x8a7a52);
  const grass = new THREE.Color(isHomePort ? 0x4a9a45 : 0x3f7d3a);
  const summitRock = new THREE.Color(0x746a5c);
  const color = t < 0.3 ? sand.clone().lerp(rock, t / 0.3) : rock.clone().lerp(grass, Math.min(1, (t - 0.3) / 0.5));
  return capMix > 0 ? color.lerp(summitRock, capMix) : color;
}

/** A hemisphere with a noise-wobbled rim and a sand/rock/grass vertex-color
 * gradient — reads as a rounded, slightly rugged hill instead of a perfect
 * cone. Geometry radius stays 1 unit tall (y in [0, hillRadius]); the mesh is
 * then y-scaled to the desired height. */
function buildHillMesh(
  hillRadius: number,
  hillHeight: number,
  baseY: number,
  isHomePort: boolean,
  wobbleSeeds: [number, number, number],
): THREE.Mesh {
  const geo = new THREE.SphereGeometry(hillRadius, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colorArr = new Float32Array(pos.count * 3);
  const [seedA, seedB, seedC] = wobbleSeeds;
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

    // Radial relief — ridges and gullies running up the slope, plus two
    // finer, smaller-amplitude octaves layered on top for rockiness. Without
    // the fine octaves the slope was smooth between the broad ridges, which
    // still read as a muffin at close range.
    //
    // All the longitude segments (64 of them) converge to a single point at
    // the pole, so any angle-dependent term's *physical* wavelength shrinks
    // toward zero there even though its angular wavelength doesn't — the
    // fine octaves aliased into a jagged starburst crack right at the
    // summit. poleFade kills relief entirely at the exact apex, the same
    // way reliefFade already kills it near the shore.
    const reliefFade = Math.min(1, t / 0.25);
    const poleFade = Math.min(1, (1 - t) / 0.08);
    const relief =
      (0.075 * Math.sin(angle * 4 + seedA * 1.3) * Math.sin(t * Math.PI * 1.4) +
        0.045 * Math.sin(angle * 7 + seedB * 2.1) * Math.sin(t * Math.PI * 2.3) +
        0.022 * Math.sin(angle * 13 + seedC * 1.7) +
        0.013 * Math.sin(angle * 23 + seedA * 3.1 + t * 11.0) +
        0.008 * Math.sin(angle * 37 + seedB * 4.4 - t * 17.0)) *
      reliefFade *
      poleFade;

    pos.setX(i, x * scaleXZ * (1 + relief));
    pos.setY(i, y * (1 + relief * 0.8));
    pos.setZ(i, z * scaleXZ * (1 + relief));

    // Irregular bare-rock summit cap — the threshold itself is jittered by
    // angle so the treeline isn't a perfect flat ring.
    const capThreshold = 0.86 + 0.06 * Math.sin(angle * 5 + seedC * 1.5) + 0.03 * Math.sin(angle * 11 + seedA * 2.2);
    const capMix = isHomePort ? 0 : THREE.MathUtils.clamp((t - capThreshold) / 0.1, 0, 1);

    // Tint the gullies slightly darker so the relief reads even in flat light.
    const shade = 0.9 + Math.random() * 0.2 + relief * 1.6;
    color.copy(heightGradientColor(t, isHomePort, capMix)).multiplyScalar(shade);
    color.toArray(colorArr, i * 3);
  }
  pos.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: specklTexture(), roughness: 0.95 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.y = hillHeight / hillRadius;
  mesh.position.y = baseY;
  // Deliberately NOT castShadow: the hill's own broad ridge/gully relief
  // (the low-frequency terms in the `relief` calc above) is large enough
  // relative to hillRadius to self-shadow, and a directional light's shadow
  // map renders that as one big soft dark smear across the slope — it reads
  // as a dirt stain, not terrain form, because the shadow is a flat binary
  // occluder test blurred by PCF, not a gradient. The vertex-color height
  // gradient plus normal-based diffuse lighting already sells the hill's
  // roundness without it. Still receives shadows (from ships, masts, etc
  // passing nearby) via receiveShadow below.
  mesh.receiveShadow = true;
  return mesh;
}

/** A squat, mostly-submerged cone that widens toward the waterline, giving
 * the hill a sandy shore instead of plunging straight into the sea. The
 * bottom edge (near/under the waterline) is darker and cooler than the top
 * (where it meets dry hillside) — a vertex-color gradient, same technique
 * buildHillMesh already uses, so wet sand actually reads differently from
 * dry sand instead of being one flat material. */
function buildBeachShelf(
  topRadius: number,
  bottomRadius: number,
  shelfHeight: number,
  topY: number,
  wobbleSeeds: [number, number, number],
): THREE.Mesh {
  // 64 radial segments, not 20 — at island scale the old count left clearly
  // visible flat facets around the whole shoreline.
  const geo = new THREE.CylinderGeometry(topRadius, bottomRadius, shelfHeight, 64, 1, true);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colorArr = new Float32Array(pos.count * 3);
  const wet = new THREE.Color(0x9c8558);
  const dry = new THREE.Color(0xdcc793);
  const color = new THREE.Color();
  const [seedA, seedB, seedC] = wobbleSeeds;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const angle = Math.atan2(z, x);

    // Same angular wobble buildHillMesh uses (and the same seeds, so the
    // shore lines up with the hill above it) — a perfectly circular
    // coastline is the single clearest "this is a primitive" tell.
    const wobble =
      0.1 * Math.sin(angle * 3 + seedA) + 0.06 * Math.sin(angle * 5 + seedB) + 0.035 * Math.sin(angle * 9 + seedC);
    const scaleXZ = 1 + wobble;
    pos.setX(i, x * scaleXZ);
    pos.setZ(i, z * scaleXZ);

    const t = THREE.MathUtils.clamp(y / shelfHeight + 0.5, 0, 1);
    color.copy(wet).lerp(dry, t).multiplyScalar(0.92 + Math.random() * 0.16);
    color.toArray(colorArr, i * 3);
  }
  pos.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    map: specklTexture(),
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = topY - shelfHeight / 2;
  mesh.receiveShadow = true;
  return mesh;
}

function buildIsland(radius: number, isHomePort: boolean): THREE.Group {
  const group = new THREE.Group();

  // Shared between the shelf and the hill so the wobbled coastline and the
  // wobbled hillside above it line up instead of fighting each other.
  const wobbleSeeds: [number, number, number] = [
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
  ];

  const hillRadius = radius * 0.85;
  const shelfHeight = radius * 0.35;
  const beachTopY = shelfHeight * 0.4;
  group.add(buildBeachShelf(hillRadius, radius * 1.15, shelfHeight, beachTopY, wobbleSeeds));

  const hillHeight = radius * (isHomePort ? 0.7 : 0.85);
  group.add(buildHillMesh(hillRadius, hillHeight, beachTopY, isHomePort, wobbleSeeds));
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

    // Base-ring rocks, plus one or two small boulder clusters scattered
    // higher up the slope (up near the new rocky cap) — previously every
    // rock sat in the same narrow band near the shore, so the upper hillside
    // had nothing but flat grass color to break it up.
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x746a5c, roughness: 1 });
    const rockCount = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < rockCount; i++) {
      const rockScale = 0.3 + Math.random() * 0.35;
      const angle = Math.random() * Math.PI * 2;
      const dist = radius * (0.55 + Math.random() * 0.35);
      const py = surfaceY(dist);

      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(rockScale, 0), rockMat);
      rock.position.set(Math.cos(angle) * dist, py + rockScale * 0.4, Math.sin(angle) * dist);
      rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      group.add(rock);
    }

    const clusterCount = 1 + Math.floor(Math.random() * 2);
    for (let c = 0; c < clusterCount; c++) {
      const clusterAngle = Math.random() * Math.PI * 2;
      const clusterDist = radius * (0.08 + Math.random() * 0.3);
      const boulders = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < boulders; i++) {
        const rockScale = 0.18 + Math.random() * 0.22;
        const jitter = 0.35 * radius * 0.15;
        const bx = Math.cos(clusterAngle) * clusterDist + (Math.random() - 0.5) * jitter;
        const bz = Math.sin(clusterAngle) * clusterDist + (Math.random() - 0.5) * jitter;
        const py = surfaceY(Math.hypot(bx, bz));

        const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(rockScale, 0), rockMat);
        rock.position.set(bx, py + rockScale * 0.4, bz);
        rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        group.add(rock);
      }
    }
  }

  return group;
}

/** Gold crates are server-owned state now (position/collection is
 * authoritative); this just builds the pickup mesh for main.ts to place. */
export function buildCrateMesh(): THREE.Mesh {
  const geo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.5, metalness: 0.3 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

/** Renders the island layout the server assigned for this session — every
 * client builds identical meshes from the same island list so everyone sees
 * the same world. */
export class World {
  islands: Island[] = [];
  homePort: Island;

  constructor(scene: THREE.Scene, islandInfos: IslandInfo[]) {
    for (const info of islandInfos) {
      const mesh = buildIsland(info.radius, info.isHomePort);
      const position = new THREE.Vector3(info.x, 0, info.z);
      mesh.position.copy(position);
      scene.add(mesh);
      this.islands.push({ position, radius: info.radius, isHomePort: info.isHomePort, mesh });
    }
    const home = this.islands.find((isl) => isl.isHomePort);
    if (!home) throw new Error('World: server sent no home port island');
    this.homePort = home;
  }

  isNearHomePort(pos: THREE.Vector3, extra = 15): boolean {
    return this.homePort.position.distanceTo(pos) < this.homePort.radius + extra;
  }
}
