import * as THREE from 'three';
import type { IslandInfo } from '../shared/protocol';
import { coastlineShapeParams, type CoastlineShape } from './Coastline';

/** Fixed-size uniform array cap — GLSL loop bounds must be constants. The
 * world currently generates 19 islands; this leaves headroom without making
 * the per-pixel loop unbounded (and the loop early-outs on a cheap squared
 * distance test anyway, so far-away entries cost almost nothing). */
const MAX_ISLANDS = 24;

/** How many ships can carve a wake at once. Wakes are picked nearest-first
 * each frame (see setWakes), so in a big fight the six closest ships get one
 * and anything further away — where a wake is a few pixels wide anyway —
 * silently doesn't. Six keeps the per-pixel loop bounded on mobile. */
const MAX_WAKES = 6;

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
    // the sea was literally taller than the boats floating in it. Keep the sum
    // here comfortably under Ship.ts's HULL_DRAFT + HULL_FREEBOARD (1.36).
    //
    // Only three low-frequency waves live in the GEOMETRY. Everything finer —
    // the chop and ripple that actually make water read as water — is done as
    // a fragment-space normal perturbation (see detailNormal below), because
    // the ocean mesh's vertex density falls off hard with distance and any
    // short-wavelength vertex displacement would alias into a shimmering mess
    // out past ~150 units. It also keeps getHeightAt() (which every floating
    // object samples) identical to what you see, which a displacement-mapped
    // chop would not.
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
  uniform vec3 uHorizonColor;
  uniform vec3 uZenithColor;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  // xy = island centre (world x, z), z = normalised shore radius
  // (island.radius / maxShape), w = coastline elongation. See Coastline.ts —
  // this is the SAME shape function World.ts builds its terrain from, so the
  // surf line tracks the actual coast instead of an idealised circle.
  uniform vec4 uIslands[${MAX_ISLANDS}];
  // x = wobble phase, y = elongation axis angle, z/w spare.
  uniform vec4 uIslandShape[${MAX_ISLANDS}];
  uniform int uIslandCount;
  // xy = ship position, zw = unit forward direction.
  uniform vec4 uWakes[${MAX_WAKES}];
  // x = speed 0..1, y = wake length in world units.
  uniform vec2 uWakeParams[${MAX_WAKES}];
  uniform int uWakeCount;

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vHeight;

  const float PI = 3.14159265;

  /** Must stay in lockstep with Coastline.ts's coastlineRadius(). */
  float coastShape(float angle, float phase, float elong, float axis) {
    float wobble =
      0.10 * sin(angle * 3.0 + phase) +
      0.06 * sin(angle * 5.0 + phase * 1.7) +
      0.035 * sin(angle * 9.0 + phase * 2.3);
    return (1.0 + wobble) * (1.0 + elong * cos(2.0 * (angle - axis)));
  }

  /** Cheap 2D value noise — one hash per corner, used only for foam breakup
   * where a couple of octaves is plenty and correctness is invisible. */
  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
      u.y);
  }

  /** Matches Sky.ts's dome gradient (minus the clouds) so the fresnel
   * reflection agrees with the sky you can actually see above it — that
   * agreement is most of what stops water reading as a painted plane. */
  vec3 skyAt(vec3 dir, vec3 L) {
    float up = clamp(dir.y, 0.0, 1.0);
    vec3 c = mix(uHorizonColor, uZenithColor, pow(up, 0.65));
    float sd = max(dot(dir, L), 0.0);
    c += vec3(1.0, 0.88, 0.66) * (pow(sd, 8.0) * 0.18 + pow(sd, 40.0) * 0.5);
    return c;
  }

  /** Four octaves of directional ripple, returned as a slope pair (d/dx,
   * d/dz) rather than a normal, so the caller can weight it by distance. The
   * geometry only carries wavelengths of ~29 units and up; this is the 1-8
   * unit chop that gives the surface texture and makes the sun break into
   * glitter instead of one broad sheen. */
  vec2 detailSlope(vec2 p, float t) {
    // Domain warp first. Without it, four straight directional sines lay down
    // a perfectly regular cross-hatch — from a low camera that reads as
    // corduroy stripes running to the horizon, which is arguably a worse tell
    // than no detail at all. Two extra sines buy an irregular, current-driven
    // surface for a fraction of the cost of real FBM.
    vec2 w = vec2(sin(p.y * 0.115 + t * 0.42), sin(p.x * 0.097 - t * 0.31)) * 2.9;
    vec2 q = p + w;

    vec2 slope = vec2(0.0);
    // dir, freq, amp, speed
    vec2 d1 = vec2(0.87, 0.49); float f1 = 0.55, a1 = 0.06, s1 = 1.9;
    vec2 d2 = vec2(-0.32, 0.95); float f2 = 0.93, a2 = 0.036, s2 = 2.6;
    vec2 d3 = vec2(0.71, -0.71); float f3 = 1.7, a3 = 0.018, s3 = 3.4;
    vec2 d4 = vec2(-0.94, -0.34); float f4 = 3.1, a4 = 0.009, s4 = 4.6;
    slope += a1 * f1 * d1 * cos(dot(p, d1) * f1 + t * s1);
    slope += a2 * f2 * d2 * cos(dot(q, d2) * f2 + t * s2);
    slope += a3 * f3 * d3 * cos(dot(q, d3) * f3 + t * s3);
    slope += a4 * f4 * d4 * cos(dot(q * 1.3, d4) * f4 + t * s4);
    return slope;
  }

  void main() {
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uSunDir);
    float viewDist = length(cameraPosition - vWorldPos);

    // ---- surface normal ---------------------------------------------------
    // Fade the fine chop out with distance: past ~220 units a ripple is well
    // under a pixel and would only alias/sparkle-crawl, and a glassy far
    // field is also what a real sea looks like from a low camera.
    float detailFade = 1.0 - smoothstep(70.0, 260.0, viewDist);
    vec2 dslope = detailSlope(vWorldPos.xz * vec2(1.0, -1.0), uTime) * detailFade;
    vec3 N = normalize(vNormal + vec3(-dslope.x, 0.0, dslope.y) * 3.0);

    // ---- shore proximity: depth colour + surf --------------------------
    // One loop over the islands produces BOTH the depth field (how far this
    // pixel is from the nearest coast, which drives the shallow/deep colour
    // ramp) and the breaking-surf band. The early-out on squared distance
    // matters: without it every pixel paid an atan plus a dozen sines for
    // islands hundreds of units away that can't possibly affect it.
    float nearestD = 1e6;
    float surf = 0.0;
    for (int i = 0; i < ${MAX_ISLANDS}; i++) {
      if (i >= uIslandCount) break;
      vec4 isl = uIslands[i];
      vec2 rel = vWorldPos.xz - isl.xy;
      float reach = isl.z * 1.6 + 46.0;
      float dd = dot(rel, rel);
      if (dd > reach * reach) continue;

      float angle = atan(rel.y, rel.x);
      vec4 shp = uIslandShape[i];
      float shoreR = isl.z * coastShape(angle, shp.x, isl.w, shp.y);
      float d = sqrt(dd) - shoreR;
      nearestD = min(nearestD, d);

      // Surf: a set of breaker lines running in toward the beach, surging
      // back and forth, torn up by noise so the wet edge isn't a drawn ring.
      float surge = 1.1 * sin(uTime * 0.75 + shp.x);
      float band = 1.0 - smoothstep(0.0, 7.0, abs(d - 1.6 - surge));
      float breakers = 0.45 + 0.55 * sin(d * 1.05 - uTime * 1.5 + angle * 5.0);
      float tear = 0.55 + 0.7 * vnoise(rel * 0.5 + vec2(uTime * 0.15, angle * 2.0));
      // A hard bright lip right at the waterline, always present.
      float lip = (1.0 - smoothstep(0.0, 2.6, abs(d + 0.4))) * 0.9;
      surf = max(surf, max(band * breakers * tear, lip));
    }

    // ---- ship wakes -------------------------------------------------------
    // Fully analytic and fragment-only: a Kelvin V, a churned centreline
    // trail, and a bow collar, all evaluated in each ship's local frame. No
    // spawned meshes, no per-frame allocation, and it costs nothing at all
    // for pixels that aren't behind a ship (the bounding reject below).
    float wake = 0.0;
    for (int i = 0; i < ${MAX_WAKES}; i++) {
      if (i >= uWakeCount) break;
      vec4 w = uWakes[i];
      vec2 par = uWakeParams[i];
      vec2 rel = vWorldPos.xz - w.xy;
      float len = par.y;
      if (dot(rel, rel) > (len + 6.0) * (len + 6.0)) continue;

      vec2 fwd = w.zw;
      float behind = -dot(rel, fwd);
      float lat = abs(dot(rel, vec2(-fwd.y, fwd.x)));
      if (behind < -3.0 || behind > len) continue;

      float fade = 1.0 - smoothstep(0.0, len, max(behind, 0.0));
      fade *= fade;
      // Wash and Kelvin arms exist ASTERN only. Without this the arms ran
      // forward at full strength to the behind > -3 cutoff and then simply
      // stopped, drawing a dead-straight foam edge across the water a couple
      // of hull lengths ahead of the bow.
      fade *= smoothstep(-2.4, -0.2, behind);

      // Churned wash directly astern — widens and dissipates. The churn is
      // sampled at two frequencies: at chase-camera range a single ~1-unit
      // octave magnifies into a soft grey smear behind the ship.
      float halfW = 0.7 + behind * 0.07;
      float trail = exp(-(lat * lat) / (halfW * halfW));
      float churn =
        0.28 + 0.36 * vnoise(vec2(lat * 2.1, behind * 1.7 - uTime * 5.0)) +
        0.26 * vnoise(vec2(lat * 5.5, behind * 4.4 - uTime * 8.0)) +
        0.2 * vnoise(vec2(lat * 13.0, behind * 10.0 - uTime * 15.0));
      trail *= churn * fade;

      // Kelvin arms, opening at the classic ~19.5 deg half-angle.
      float armOffset = abs(lat - max(behind, 0.0) * 0.355);
      float arm = exp(-(armOffset * armOffset) / 1.15) * fade;
      arm *= 0.45 + 0.55 * sin(behind * 1.6 - uTime * 3.0);

      // Bow collar: the white moustache pushed up ahead of the stem.
      float bow = (1.0 - smoothstep(0.0, 2.2, abs(behind + 0.7))) *
                  (1.0 - smoothstep(0.7, 2.3, lat));

      wake = max(wake, (trail * 1.05 + arm * 0.75 + bow * 0.9) * par.x);
    }
    wake = clamp(wake, 0.0, 1.0);

    // ---- water body colour -------------------------------------------
    vec3 abyss = vec3(0.010, 0.085, 0.205);
    vec3 openSea = vec3(0.022, 0.225, 0.375);
    vec3 shelf = vec3(0.10, 0.52, 0.60);
    vec3 sandBed = vec3(0.42, 0.72, 0.66);
    vec3 foam = vec3(0.93, 0.98, 1.0);

    // Large, slow variation across open water so a big empty stretch of sea
    // isn't one flat value — reads as current and depth change.
    float swell = 0.5 + 0.5 * sin(vWorldPos.x * 0.0043 + 0.7) * sin(vWorldPos.z * 0.0037 - 0.4);
    vec3 deepColor = mix(abyss, openSea, swell);

    // Depth ramp toward shore. nearestD is signed distance outside the
    // coastline, so it goes negative inside a lagoon (where the terrain is
    // below sea level) and lights that up as bright sand-bottom water.
    float shallow = 1.0 - smoothstep(-2.0, 34.0, nearestD);
    float verySh = 1.0 - smoothstep(-4.0, 9.0, nearestD);
    vec3 baseColor = mix(deepColor, shelf, shallow * shallow);
    baseColor = mix(baseColor, sandBed, verySh * 0.75);

    // Subsurface glow: light scattering up through the back of a wave face.
    float backlight = pow(clamp(dot(V, -L) * 0.5 + 0.5, 0.0, 1.0), 3.0);
    baseColor += vec3(0.03, 0.13, 0.11) * backlight * (0.35 + shallow * 0.9);
    baseColor += vec3(0.02, 0.08, 0.07) * smoothstep(-0.1, 0.7, vHeight);

    // ---- lighting ---------------------------------------------------------
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    vec3 reflDir = reflect(-V, N);
    reflDir.y = abs(reflDir.y);
    vec3 reflected = skyAt(reflDir, L);

    // Fairly high diffuse contrast on purpose: looking almost straight down
    // at the water (which is most of the chase camera's lower screen) fresnel
    // is near zero, so this term is the ONLY thing that can show the ripple
    // detail there. At 0.3/0.7 the near field read as a flat dark slab.
    float diff = max(dot(N, L), 0.0) * 0.46 + 0.56;
    vec3 color = mix(baseColor * diff, reflected, clamp(fresnel * 0.92, 0.0, 0.85));

    // Sun glitter. Two lobes: a broad sheen, and a very tight one that the
    // fine chop breaks into individual sparkles rather than one wet smear.
    vec3 H = normalize(V + L);
    float ndh = max(dot(N, H), 0.0);
    float sheen = pow(ndh, 60.0) * 0.35;
    float glint = pow(ndh, 620.0) * 3.2 * detailFade;
    color += vec3(1.0, 0.96, 0.85) * (sheen + glint);

    // ---- foam -------------------------------------------------------------
    // Whitecaps: gated on BOTH crest height and how steep the face is, then
    // torn up by high-frequency noise. Gating on height alone (which is what
    // the first pass here did, and what the shader before it did) paints
    // every wide, gentle swell top solid white — the sea ends up covered in
    // soft milky blobs that read as fog on the water rather than as spray.
    // Real whitecaps only appear where a wave is actually breaking, which is
    // where the slope is high, and they are small and sparse.
    float steep = clamp(length(vec2(vNormal.x, vNormal.z)) * 5.2, 0.0, 1.0);
    float crest = smoothstep(0.5, 0.8, vHeight) * steep;
    float tex = vnoise(vWorldPos.xz * 1.35 + vec2(uTime * 0.5, -uTime * 0.3));
    float tex2 = vnoise(vWorldPos.xz * 3.9 - vec2(uTime * 0.9, uTime * 0.55));
    float crestFoam = crest * smoothstep(0.52, 0.88, tex * 0.65 + tex2 * 0.5) * detailFade;

    float foamAmt = clamp(max(max(crestFoam * 0.7, surf), wake), 0.0, 1.0);
    // Foam is textured too — a flat white mask is the giveaway of a cheap
    // water shader.
    float foamTex = 0.62 + 0.5 * vnoise(vWorldPos.xz * 3.2 + vec2(uTime * 0.9, uTime * 0.4));
    color = mix(color, foam * foamTex, clamp(foamAmt * 0.92, 0.0, 1.0));

    // ---- aerial perspective ----------------------------------------------
    float fogAmt = smoothstep(uFogNear, uFogFar, viewDist);
    color = mix(color, uFogColor, fogAmt);

    gl_FragColor = vec4(color, 1.0);
  }
`;

/** How aggressively vertex density falls off away from the mesh centre — see
 * the "uniform PlaneGeometry grid" comment in the constructor for the full
 * rationale. Module-level rather than a constructor param since it's a
 * tuning constant, not something callers should vary per instance. */
const WARP_POWER = 1.8;

export interface OceanOptions {
  horizonColor?: number;
  zenithColor?: number;
  fogColor?: number;
  fogNear?: number;
  fogFar?: number;
}

export class Ocean {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  /** World units between the two vertices nearest the mesh centre — the
   * finest gap the warped grid produces. The mesh is snapped to this grid
   * when following the player so the surface never crawls or swims; using
   * the finest gap (rather than an average) keeps that snap imperceptible
   * right under the ship, which is the only place the eye can tell. */
  private readonly cellSize: number;

  private wakeCount = 0;

  constructor(
    size = 1800,
    segments = 256,
    sunDirection: THREE.Vector3 = new THREE.Vector3(120, 200, 80),
    opts: OceanOptions = {},
  ) {
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
        // Mirrors of Sky.ts's dome colours and the scene fog. Passed in
        // explicitly rather than read from three's fog uniforms so the
        // reflection and the sky can never silently drift apart.
        uHorizonColor: { value: new THREE.Color(opts.horizonColor ?? 0xcfeaf6) },
        uZenithColor: { value: new THREE.Color(opts.zenithColor ?? 0x2f6fb5) },
        uFogColor: { value: new THREE.Color(opts.fogColor ?? 0xcfeaf6) },
        uFogNear: { value: opts.fogNear ?? 200 },
        uFogFar: { value: opts.fogFar ?? 950 },
        uIslands: { value: Array.from({ length: MAX_ISLANDS }, () => new THREE.Vector4()) },
        uIslandShape: { value: Array.from({ length: MAX_ISLANDS }, () => new THREE.Vector4()) },
        uIslandCount: { value: 0 },
        uWakes: { value: Array.from({ length: MAX_WAKES }, () => new THREE.Vector4()) },
        uWakeParams: { value: Array.from({ length: MAX_WAKES }, () => new THREE.Vector2()) },
        uWakeCount: { value: 0 },
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
    const target = this.material.uniforms.uIslands.value as THREE.Vector4[];
    const shape = this.material.uniforms.uIslandShape.value as THREE.Vector4[];
    const count = Math.min(islands.length, MAX_ISLANDS);
    for (let i = 0; i < count; i++) {
      const s: CoastlineShape = coastlineShapeParams(islands[i]);
      target[i].set(islands[i].x, islands[i].z, s.scale, s.elongation);
      shape[i].set(s.phase, s.axis, 0, 0);
    }
    this.material.uniforms.uIslandCount.value = count;
  }

  /** Wake feed. Called once per frame from the render loop, allocation-free:
   *   beginWakes(); addWake(...) per ship; endWakes();
   * Ships past MAX_WAKES are dropped, so callers should add nearest-first. */
  beginWakes() {
    this.wakeCount = 0;
  }

  addWake(x: number, z: number, dirX: number, dirZ: number, speed01: number) {
    if (this.wakeCount >= MAX_WAKES || speed01 <= 0.02) return;
    const wakes = this.material.uniforms.uWakes.value as THREE.Vector4[];
    const params = this.material.uniforms.uWakeParams.value as THREE.Vector2[];
    const len = Math.hypot(dirX, dirZ) || 1;
    wakes[this.wakeCount].set(x, z, dirX / len, dirZ / len);
    // Faster ships leave a longer, stronger scar; the length also keeps the
    // fragment loop's bounding reject tight for a drifting ship.
    params[this.wakeCount].set(Math.min(1, speed01), 12 + 30 * Math.min(1, speed01));
    this.wakeCount++;
  }

  endWakes() {
    this.material.uniforms.uWakeCount.value = this.wakeCount;
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
