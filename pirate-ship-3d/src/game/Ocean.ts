import * as THREE from 'three';

const vertexShader = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorldPos;
  varying float vHeight;

  float wave(vec2 p, vec2 dir, float freq, float amp, float speed, float t) {
    return sin(dot(p, dir) * freq + t * speed) * amp;
  }

  void main() {
    vec3 pos = position;
    vec2 p = pos.xy;
    float h = 0.0;
    h += wave(p, normalize(vec2(1.0, 0.3)), 0.06, 0.9, 1.4, uTime);
    h += wave(p, normalize(vec2(-0.4, 1.0)), 0.11, 0.5, 1.9, uTime);
    h += wave(p, normalize(vec2(0.7, -0.6)), 0.22, 0.25, 2.6, uTime);
    pos.z += h;
    vHeight = h;
    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vWorldPos;
  varying float vHeight;

  void main() {
    vec3 deep = vec3(0.02, 0.13, 0.28);
    vec3 shallow = vec3(0.09, 0.42, 0.55);
    vec3 foam = vec3(0.85, 0.95, 0.98);

    float t = smoothstep(-0.6, 1.2, vHeight);
    vec3 color = mix(deep, shallow, t);
    float foamMix = smoothstep(1.05, 1.5, vHeight);
    color = mix(color, foam, foamMix * 0.6);

    gl_FragColor = vec4(color, 1.0);
  }
`;

export class Ocean {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(size = 4000, segments = 180) {
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uTime: { value: 0 } },
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
