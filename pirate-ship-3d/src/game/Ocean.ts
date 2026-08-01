import * as THREE from 'three';
import type { IslandInfo } from '../shared/protocol';

/** Fixed-size uniform array cap — GLSL loop bounds must be constants, and the
 * world only ever has ~13 islands, so this leaves comfortable headroom. */
const MAX_ISLANDS = 16;

const vertexShader = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vHeight;

  vec3 waveWithDeriv(vec2 p, vec2 dir, float freq, float amp, float speed, float t) {
    float phase = dot(p, dir) * freq + t * speed;
    float s = sin(phase);
    float c = cos(phase);
    return vec3(amp * s, amp * freq * dir.x * c, amp * freq * dir.y * c);
  }

  void main() {
    // The wave field is evaluated in WORLD space, not mesh-local space, so
    // the mesh can follow the player without the waves sliding along with
    // it. p.y = -worldZ matches getHeightAt()'s convention below.
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec2 p = vec2(world.x, -world.z);

    // Amplitudes are deliberately small RELATIVE TO A SHIP. They used to sum
    // to 1.65 (3.3 peak-to-trough) against a hull only ~0.9 deep and 4 long:
    // the sea was literally taller than the boats floating in it, so the water
    // 8 units from a ship could be a full hull-depth lower than the ship's own
    // waterline. From the chase camera — which looks down over exactly that
    // patch of water — you therefore saw the ship's entire underbody and keel
    // hanging in mid-air, or, half a wave later, water standing above its
    // gunwale. That mismatch, not the hull's Y offset, is why ships never
    // read as sitting *in* the sea. Keep the sum here comfortably under
    // Ship.ts's HULL_DRAFT + HULL_FREEBOARD. Frequencies are unchanged (the
    // shortest wavelength, ~29 units, is already near what the warped ocean
    // mesh can resolve at distance without shimmering).
    vec3 w1 = waveWithDeriv(p, normalize(vec2(1.0, 0.3)), 0.06, 0.46, 1.4, uTime);
    vec3 w2 = waveWithDeriv(p, normalize(vec2(-0.4, 1.0)), 0.11, 0.25, 1.9, uTime);
    vec3 w3 = waveWithDeriv(p, normalize(vec2(0.7, -0.6)), 0.22, 0.13, 2.6, uTime);
    float h = w1.x + w2.x + w3.x;
    float dhdx = w1.y + w2.y + w3.y; // d(h)/d(worldX)
    float dhdy = w1.z + w2.z + w3.z; // d(h)/d(p.y), and p.y = -worldZ

    world.y += h;
    vHeight = h;

    // Analytic surface normal from the wave slope, so the water actually
    // catches light instead of reading as a flat painted color. For a
    // height field y = h(x,z): N = normalize(-dh/dx, 1, -dh/dz), and
    // dh/dz = -dhdy because p.y is negated world z.
    vNormal = normalize(vec3(-dhdx, 1.0, dhdy));

    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSunDir;
  uniform float uTime;
  // xy = island center (world x, z), z = effective shore radius
  // (island.radius * 1.15, matching the beach shelf's actual bottom radius
  // in World.ts).
  uniform vec3 uIslands[${MAX_ISLANDS}];
  uniform int uIslandCount;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vHeight;

  /** A soft, animated band straddling an island's shoreline — reuses the
   * same "foam" color as wave-crest foam rather than a separate system.
   * The shore radius is perturbed by the same angular wobble World.ts uses
   * on the island geometry, so the foam follows an irregular coastline
   * instead of drawing a mathematically perfect ring. */
  float shoreFoam() {
    float total = 0.0;
    for (int i = 0; i < ${MAX_ISLANDS}; i++) {
      if (i >= uIslandCount) break;
      vec3 isl = uIslands[i];
      vec2 rel = vWorldPos.xz - isl.xy;
      float angle = atan(rel.y, rel.x);
      // Matches buildBeachShelf's wobble amplitudes; the phase offsets are
      // per-island (derived from position) rather than shared.
      float phase = isl.x * 0.37 + isl.y * 0.71;
      float wobble =
        0.10 * sin(angle * 3.0 + phase) +
        0.06 * sin(angle * 5.0 + phase * 1.7) +
        0.035 * sin(angle * 9.0 + phase * 2.3);
      float shoreR = isl.z * (1.0 + wobble);

      float d = length(rel) - shoreR;
      // Surf runs up and back rather than sitting still.
      float surge = 0.9 * sin(uTime * 0.9 + phase);
      float band = 1.0 - smoothstep(0.0, 3.0, abs(d - 1.0 - surge));
      band *= 0.55 + 0.45 * sin(d * 2.2 - uTime * 1.6 + angle * 4.0);
      total = max(total, band);
    }
    return total;
  }

  void main() {
    vec3 deep = vec3(0.02, 0.13, 0.28);
    vec3 shallow = vec3(0.09, 0.42, 0.55);
    vec3 foam = vec3(0.85, 0.95, 0.98);
    vec3 skyReflect = vec3(0.60, 0.79, 0.93);

    // Thresholds are fractions of the new ±0.84 height range — the old
    // absolute -0.6/1.2 and 1.05/1.5 numbers were tuned against the old ±1.65
    // range and would now never be reached at all, so crest foam would simply
    // have stopped existing.
    float t = smoothstep(-0.31, 0.61, vHeight);
    vec3 baseColor = mix(deep, shallow, t);

    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uSunDir);

    // Fresnel: water reads more like sky reflection at grazing angles,
    // more like true water color looking straight down — this alone is
    // most of what separates "painted plane" from "water."
    float fresnel = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
    vec3 color = mix(baseColor, skyReflect, fresnel * 0.65);

    // Soft directional shading from the sun (never fully dark, water always
    // scatters some light) plus a tight specular glint on wave faces.
    float diff = max(dot(N, L), 0.0) * 0.35 + 0.65;
    color *= diff;

    vec3 H = normalize(V + L);
    float spec = pow(max(dot(N, H), 0.0), 120.0);
    color += vec3(1.0, 0.97, 0.88) * spec * 0.9;

    float foamMix = max(smoothstep(0.53, 0.76, vHeight), shoreFoam() * 0.85);
    color = mix(color, foam, foamMix * 0.6);

    gl_FragColor = vec4(color, 1.0);
  }
`;

/** How aggressively vertex density falls off away from the mesh centre — see
 * the "uniform PlaneGeometry grid" comment in the constructor for the full
 * rationale. Module-level rather than a constructor param since it's a
 * tuning constant, not something callers should vary per instance. */
const WARP_POWER = 1.8;

export class Ocean {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  /** World units between the two vertices nearest the mesh centre — the
   * finest gap the warped grid produces. The mesh is snapped to this grid
   * when following the player so the surface never crawls or swims; using
   * the finest gap (rather than an average) keeps that snap imperceptible
   * right under the ship, which is the only place the eye can tell. */
  private readonly cellSize: number;

  constructor(size = 1800, segments = 256, sunDirection: THREE.Vector3 = new THREE.Vector3(120, 200, 80)) {
    const half = size / 2;
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);

    // The uniform PlaneGeometry grid spends the same vertex density on the
    // outer edge (well past the fog-out distance of 950, where the surface
    // is fully hidden) as it does right under the player's ship, where wave
    // detail actually matters. Re-map each vertex's distance from the mesh
    // centre through a power curve (u -> sign(u)*|u|^WARP_POWER) instead of
    // leaving it linear: same vertex/triangle count and topology (no seams
    // to stitch, still one PlaneGeometry), just packed densely near the
    // centre and coarser toward the edges, which is where they belong.
    const posAttr = geometry.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const ux = posAttr.getX(i) / half;
      const uy = posAttr.getY(i) / half;
      posAttr.setX(i, Math.sign(ux) * Math.pow(Math.abs(ux), WARP_POWER) * half);
      posAttr.setY(i, Math.sign(uy) * Math.pow(Math.abs(uy), WARP_POWER) * half);
    }
    posAttr.needsUpdate = true;

    const duNormalized = 1 / (segments / 2);
    this.cellSize = half * Math.pow(duNormalized, WARP_POWER);

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        // Pass the scene's actual sun position so the water's specular
        // glint lines up with the real DirectionalLight, not a guess.
        uSunDir: { value: sunDirection.clone().normalize() },
        uIslands: { value: Array.from({ length: MAX_ISLANDS }, () => new THREE.Vector3()) },
        uIslandCount: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.receiveShadow = true;
  }

  update(time: number) {
    this.material.uniforms.uTime.value = time;
  }

  /** Keep the (finite) water mesh centred on the player, snapped to the
   * vertex grid. Previously the plane was static at the origin and stopped
   * well short of the fog distance, so sailing toward the world edge would
   * eventually show the ocean simply ending. */
  followTarget(x: number, z: number) {
    const snappedX = Math.round(x / this.cellSize) * this.cellSize;
    const snappedZ = Math.round(z / this.cellSize) * this.cellSize;
    this.mesh.position.set(snappedX, 0, snappedZ);
  }

  /** Islands arrive from the server (welcome message) after Ocean is already
   * constructed, so this is set once the world is known rather than passed
   * to the constructor. Silently drops islands beyond MAX_ISLANDS. */
  setIslands(islands: IslandInfo[]) {
    const target = this.material.uniforms.uIslands.value as THREE.Vector3[];
    const count = Math.min(islands.length, MAX_ISLANDS);
    for (let i = 0; i < count; i++) {
      target[i].set(islands[i].x, islands[i].z, islands[i].radius * 1.15);
    }
    this.material.uniforms.uIslandCount.value = count;
  }

  /** Approximate wave height at a world x,z — mirrors the vertex shader math.
   * The plane is rotated -90deg about X, so shader-local y = -world z. */
  getHeightAt(x: number, worldZ: number, time: number): number {
    const y = -worldZ;
    const dir1 = normalize(1.0, 0.3);
    const dir2 = normalize(-0.4, 1.0);
    const dir3 = normalize(0.7, -0.6);
    let h = 0;
    h += Math.sin((x * dir1[0] + y * dir1[1]) * 0.06 + time * 1.4) * 0.46;
    h += Math.sin((x * dir2[0] + y * dir2[1]) * 0.11 + time * 1.9) * 0.25;
    h += Math.sin((x * dir3[0] + y * dir3[1]) * 0.22 + time * 2.6) * 0.13;
    return h;
  }
}

function normalize(x: number, y: number): [number, number] {
  const len = Math.hypot(x, y);
  return [x / len, y / len];
}
