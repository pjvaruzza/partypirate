import * as THREE from 'three';
import type { IslandInfo } from '../shared/protocol';
import { coastlineShapeParams } from './Coastline';
import { buildTerrain } from './IslandTerrain';
import { buildIslandProps } from './IslandProps';

export interface Island {
  position: THREE.Vector3;
  radius: number;
  isHomePort: boolean;
  mesh: THREE.Group;
}

/** Assembles the islands the server laid out.
 *
 * The geometry itself now lives in IslandTerrain.ts (a per-archetype
 * heightfield) and IslandProps.ts (all dressing baked into one merged,
 * vertex-coloured mesh). This file is just the seam between the server's
 * island list and those two.
 *
 * The important behavioural change here is determinism: every wobble, palm
 * position and archetype choice is derived from a hash of the island's
 * server-sent position (see Coastline.ts) instead of `Math.random()`. The old
 * code claimed in a comment that "every client builds identical meshes from
 * the same island list" while seeding its coastline wobble from Math.random —
 * so in a multiplayer game the shape of the land was different on every
 * screen, and the ocean's surf ring never lined up with the beach it was
 * supposedly breaking on.
 */
function buildIsland(info: IslandInfo): THREE.Group {
  const group = new THREE.Group();
  const shape = coastlineShapeParams(info);
  const terrain = buildTerrain(info.radius, shape);
  group.add(terrain.mesh);
  const props = buildIslandProps(info.radius, shape, terrain);
  if (props) group.add(props);
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
      const mesh = buildIsland(info);
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
