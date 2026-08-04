import * as THREE from 'three';

/** Accumulates many small vertex-coloured pieces into ONE BufferGeometry.
 *
 * Islands used to add a separate THREE.Mesh per palm, per boulder and per hut
 * — twelve-odd draw calls each, ~150 across the world before a single ship was
 * drawn. Dressing an island properly (real palms with fronds, wrecks, ruins,
 * sea stacks) would have multiplied that. Everything an island wears is
 * therefore baked into a single geometry with vertex colours, so an island's
 * entire prop set is one draw call regardless of how much is on it.
 *
 * Deliberately not three's BufferGeometryUtils: this needs to bake a colour
 * per source piece anyway, and doing that here avoids allocating a throwaway
 * colour attribute on every one of the hundreds of source geometries.
 */
export class GeoBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private colors: number[] = [];
  private uvs: number[] = [];

  private static readonly _normalMatrix = new THREE.Matrix3();
  private static readonly _v = new THREE.Vector3();
  private static readonly _n = new THREE.Vector3();

  get isEmpty(): boolean {
    return this.positions.length === 0;
  }

  /**
   * @param color  flat colour, or a callback given the LOCAL vertex position
   *               (useful for gradients up a trunk or down a cliff face).
   */
  add(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.Color | ((local: THREE.Vector3) => THREE.Color)) {
    const src = geo.index ? geo.toNonIndexed() : geo;
    const pos = src.attributes.position as THREE.BufferAttribute;
    const nrm = src.attributes.normal as THREE.BufferAttribute | undefined;
    const uv = src.attributes.uv as THREE.BufferAttribute | undefined;
    const nm = GeoBuilder._normalMatrix.getNormalMatrix(matrix);
    const v = GeoBuilder._v;
    const n = GeoBuilder._n;

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const c = typeof color === 'function' ? color(v) : color;
      this.colors.push(c.r, c.g, c.b);
      v.applyMatrix4(matrix);
      this.positions.push(v.x, v.y, v.z);
      if (nrm) {
        n.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
        this.normals.push(n.x, n.y, n.z);
      } else {
        this.normals.push(0, 1, 0);
      }
      if (uv) this.uvs.push(uv.getX(i), uv.getY(i));
      else this.uvs.push(0, 0);
    }
    if (src !== geo) src.dispose();
  }

  /** Appends a raw triangle list (positions in final/world-local space). */
  addTriangles(tri: number[], color: THREE.Color) {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < tri.length; i += 9) {
      a.set(tri[i], tri[i + 1], tri[i + 2]);
      b.set(tri[i + 3], tri[i + 4], tri[i + 5]);
      c.set(tri[i + 6], tri[i + 7], tri[i + 8]);
      n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).normalize();
      for (const p of [a, b, c]) {
        this.positions.push(p.x, p.y, p.z);
        this.normals.push(n.x, n.y, n.z);
        this.colors.push(color.r, color.g, color.b);
        this.uvs.push(0, 0);
      }
    }
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geo.computeBoundingSphere();
    return geo;
  }
}
