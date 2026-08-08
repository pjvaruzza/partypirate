import * as THREE from 'three';

/** The sky used to be a 2×256 canvas gradient assigned to `scene.background`,
 * which three.js draws as a screen-space quad — so it never responded to
 * where the camera was looking, had no sun, and read as a flat backdrop.
 * This is a real dome: a horizon→zenith gradient, a sun disc and glow placed
 * at the scene's actual light direction, and a drifting procedural cloud
 * layer, all evaluated from the view direction. */

const vertexShader = /* glsl */ `
  varying vec3 vDir;

  void main() {
    // The dome is centred on the camera, so the local vertex direction is
    // the view direction.
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uHorizonColor;
  uniform vec3 uZenithColor;
  uniform float uTime;
  varying vec3 vDir;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p *= 2.02;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float up = clamp(dir.y, 0.0, 1.0);

    // Sky gradient — pale and slightly warm at the horizon (matching the
    // scene fog so distant geometry dissolves into it) deepening to blue
    // overhead.
    vec3 color = mix(uHorizonColor, uZenithColor, pow(up, 0.65));

    vec3 L = normalize(uSunDir);
    float sd = dot(dir, L);

    // Broad atmospheric scatter around the sun, then a tight disc.
    float haze = pow(max(sd, 0.0), 8.0) * 0.18 + pow(max(sd, 0.0), 64.0) * 0.35;
    color += vec3(1.0, 0.88, 0.66) * haze;

    float disc = smoothstep(0.9986, 0.9994, sd);
    color = mix(color, vec3(1.0, 0.97, 0.88), disc);

    // Drifting cloud layer, projected onto a flat plane overhead. Faded out
    // near the horizon (where the projection stretches to infinity) and
    // gated on dir.y so the noise is only evaluated where it is visible.
    if (dir.y > 0.015) {
      // The plane projection compresses hard as dir.y grows, so this scale
      // has to be large or the whole visible sky samples one near-constant
      // patch of noise and no clouds appear at all.
      vec2 uv = dir.xz / max(dir.y, 0.05) * 2.6 + vec2(uTime * 0.012, uTime * 0.006);
      float d = fbm(uv);
      float cloud = smoothstep(0.42, 0.72, d) * smoothstep(0.015, 0.22, dir.y);
      // Lit from the sun side so the cloud bank isn't uniformly white.
      vec3 cloudColor = mix(vec3(0.78, 0.82, 0.88), vec3(1.0, 0.98, 0.94), max(sd, 0.0) * 0.5 + 0.5);
      color = mix(color, cloudColor, cloud * 0.55);
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;

export class Sky {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(sunDirection: THREE.Vector3, horizonColor = 0xcfeaf6, zenithColor = 0x2f6fb5, radius = 1500) {
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      // The dome *is* the background; fogging it would grey out the whole sky.
      fog: false,
      uniforms: {
        uSunDir: { value: sunDirection.clone().normalize() },
        uHorizonColor: { value: new THREE.Color(horizonColor) },
        uZenithColor: { value: new THREE.Color(zenithColor) },
        uTime: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 20), this.material);
    // Drawn first, and never occludes anything.
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
  }

  update(time: number) {
    this.material.uniforms.uTime.value = time;
  }

  /** Keep the dome centred on the viewer so it can never be sailed out of. */
  followTarget(x: number, y: number, z: number) {
    this.mesh.position.set(x, y, z);
  }
}
