import * as THREE from 'three';

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
    vec3 pos = position;
    vec2 p = pos.xy;

    vec3 w1 = waveWithDeriv(p, normalize(vec2(1.0, 0.3)), 0.06, 0.9, 1.4, uTime);
    vec3 w2 = waveWithDeriv(p, normalize(vec2(-0.4, 1.0)), 0.11, 0.5, 1.9, uTime);
    vec3 w3 = waveWithDeriv(p, normalize(vec2(0.7, -0.6)), 0.22, 0.25, 2.6, uTime);
    float h = w1.x + w2.x + w3.x;
    float dhdx = w1.y + w2.y + w3.y;
    float dhdy = w1.z + w2.z + w3.z;

    pos.z += h;
    vHeight = h;

    // Analytic surface normal from the wave slope, so the water actually
    // catches light instead of reading as a flat painted color.
    vec3 localNormal = normalize(vec3(-dhdx, -dhdy, 1.0));
    vNormal = normalize(mat3(modelMatrix) * localNormal);

    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSunDir;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vHeight;

  void main() {
    vec3 deep = vec3(0.02, 0.13, 0.28);
    vec3 shallow = vec3(0.09, 0.42, 0.55);
    vec3 foam = vec3(0.85, 0.95, 0.98);
    vec3 skyReflect = vec3(0.60, 0.79, 0.93);

    float t = smoothstep(-0.6, 1.2, vHeight);
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

    float foamMix = smoothstep(1.05, 1.5, vHeight);
    color = mix(color, foam, foamMix * 0.6);

    gl_FragColor = vec4(color, 1.0);
  }
`;

export class Ocean {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(size = 4000, segments = 180, sunDirection: THREE.Vector3 = new THREE.Vector3(120, 200, 80)) {
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        // Pass the scene's actual sun position so the water's specular
        // glint lines up with the real DirectionalLight, not a guess.
        uSunDir: { value: sunDirection.clone().normalize() },
      },
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.receiveShadow = true;
  }

  update(time: number) {
    this.material.uniforms.uTime.value = time;
  }

  /** Approximate wave height at a world x,z — mirrors the vertex shader math.
   * The plane is rotated -90deg about X, so shader-local y = -world z. */
  getHeightAt(x: number, worldZ: number, time: number): number {
    const y = -worldZ;
    const dir1 = normalize(1.0, 0.3);
    const dir2 = normalize(-0.4, 1.0);
    const dir3 = normalize(0.7, -0.6);
    let h = 0;
    h += Math.sin((x * dir1[0] + y * dir1[1]) * 0.06 + time * 1.4) * 0.9;
    h += Math.sin((x * dir2[0] + y * dir2[1]) * 0.11 + time * 1.9) * 0.5;
    h += Math.sin((x * dir3[0] + y * dir3[1]) * 0.22 + time * 2.6) * 0.25;
    return h;
  }
}

function normalize(x: number, y: number): [number, number] {
  const len = Math.hypot(x, y);
  return [x / len, y / len];
}
