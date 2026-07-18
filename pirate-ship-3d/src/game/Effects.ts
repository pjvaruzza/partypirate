import * as THREE from 'three';

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  gravity: number;
}

interface BurstOptions {
  position: THREE.Vector3;
  count: number;
  color: number;
  speed: number;
  size: number;
  life: number;
  gravity?: number;
  spreadUp?: number;
  additive?: boolean;
}

/** Lightweight particle bursts for muzzle flashes, splashes, splinters and
 * sinking explosions — cheap geometry-sharing meshes with a short lifetime,
 * no external assets or texture atlases needed. */
export class Effects {
  private scene: THREE.Scene;
  private particles: Particle[] = [];
  private sharedGeo = new THREE.SphereGeometry(0.12, 6, 6);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  private spawnBurst(opts: BurstOptions) {
    for (let i = 0; i < opts.count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: opts.color,
        transparent: true,
        blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(this.sharedGeo, mat);
      const size = opts.size * (0.6 + Math.random() * 0.8);
      mesh.scale.setScalar(size);
      mesh.position.copy(opts.position);
      this.scene.add(mesh);

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * (opts.spreadUp ?? Math.PI);
      const dir = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
      );
      const velocity = dir.multiplyScalar(opts.speed * (0.5 + Math.random() * 0.7));

      this.particles.push({
        mesh,
        velocity,
        life: opts.life,
        maxLife: opts.life,
        gravity: opts.gravity ?? 9.8,
      });
    }
  }

  muzzleFlash(position: THREE.Vector3, direction: THREE.Vector3) {
    const flashPos = position.clone().addScaledVector(direction, 0.6);
    this.spawnBurst({
      position: flashPos,
      count: 5,
      color: 0xffcf6b,
      speed: 3,
      size: 0.22,
      life: 0.14,
      gravity: 0,
      additive: true,
    });
  }

  splash(position: THREE.Vector3) {
    this.spawnBurst({
      position,
      count: 8,
      color: 0xdff2ff,
      speed: 5,
      size: 0.16,
      life: 0.5,
      gravity: 6,
      spreadUp: Math.PI * 0.5,
    });
  }

  impactSplinters(position: THREE.Vector3) {
    this.spawnBurst({ position, count: 6, color: 0x6b4423, speed: 6, size: 0.13, life: 0.45, gravity: 12 });
  }

  /** A hull-to-hull ramming collision — bigger and woodier than a single
   * cannonball's impactSplinters, since it's two ships crashing together. */
  hullCrunch(position: THREE.Vector3) {
    this.spawnBurst({ position, count: 16, color: 0x5c3a21, speed: 8, size: 0.24, life: 0.55, gravity: 11 });
    this.spawnBurst({
      position,
      count: 7,
      color: 0xffffff,
      speed: 3,
      size: 0.32,
      life: 0.14,
      gravity: 0,
      additive: true,
    });
  }

  sinkExplosion(position: THREE.Vector3) {
    this.spawnBurst({ position, count: 22, color: 0x2b2b2b, speed: 8.5, size: 0.36, life: 1.2, gravity: 9 });
    this.spawnBurst({
      position,
      count: 16,
      color: 0xffddaa,
      speed: 6,
      size: 0.3,
      life: 0.45,
      gravity: 2,
      additive: true,
    });
    // A bright, near-instant flash at the core for a bigger initial "boom" pop.
    this.spawnBurst({
      position,
      count: 6,
      color: 0xffffff,
      speed: 2,
      size: 0.55,
      life: 0.16,
      gravity: 0,
      additive: true,
    });
  }

  update(dt: number) {
    for (const p of this.particles) {
      p.life -= dt;
      p.velocity.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, p.life / p.maxLife);
    }
    for (const p of this.particles) {
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.MeshBasicMaterial).dispose();
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }
}
