import * as THREE from 'three';

function buildMarkerGroup(): THREE.Group {
  const group = new THREE.Group();

  const beamGeo = new THREE.CylinderGeometry(0.35, 0.35, 60, 12, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffd23f,
    transparent: true,
    opacity: 0.32,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.y = 30;
  group.add(beam);

  const gemGeo = new THREE.OctahedronGeometry(1.1, 0);
  const gemMat = new THREE.MeshStandardMaterial({
    color: 0xffd23f,
    emissive: 0xffb300,
    emissiveIntensity: 0.8,
    metalness: 0.4,
    roughness: 0.3,
  });
  const gem = new THREE.Mesh(gemGeo, gemMat);
  gem.position.y = 2.2;
  gem.name = 'gem';
  group.add(gem);

  return group;
}

/** A glowing beam + gem marking the current player's active treasure-map dig
 * site (if any) — personal to the viewer, since the server only ever sends
 * `treasureHunt` in that player's own economy snapshot. One instance is
 * created up front and just toggled visible/positioned rather than rebuilt,
 * since there's ever only one per client. */
export class TreasureMarker {
  readonly group: THREE.Group;
  private active = false;

  constructor(scene: THREE.Scene) {
    this.group = buildMarkerGroup();
    this.group.visible = false;
    scene.add(this.group);
  }

  setTarget(target: { x: number; z: number } | null) {
    if (!target) {
      this.active = false;
      this.group.visible = false;
      return;
    }
    this.active = true;
    this.group.visible = true;
    this.group.position.x = target.x;
    this.group.position.z = target.z;
  }

  update(dt: number, elapsed: number, waterHeight: number) {
    if (!this.active) return;
    this.group.position.y = waterHeight;
    const gem = this.group.getObjectByName('gem');
    if (gem) {
      gem.rotation.y += dt * 1.5;
      gem.position.y = 2.2 + Math.sin(elapsed * 2) * 0.3;
    }
  }
}
