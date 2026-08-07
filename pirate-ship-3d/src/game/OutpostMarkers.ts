import * as THREE from 'three';
import type { OutpostInfo } from '../shared/protocol';

/** Minimal, deliberately-placeholder rendering for capturable outposts.
 *
 * Two pieces of information, and only two, because both are load-bearing for
 * playing the mechanic at all:
 *
 *  1. **A flag whose colour says who owns it** — grey = neutral (free to
 *     take), green = yours (you can bank and refit here), red = someone
 *     else's. It pulses while a garrison is out, i.e. while the island is
 *     actively being fought over.
 *  2. **A ring on the water at the dock radius** — the server banks your hold
 *     the instant you cross it, so the player needs to see where "close
 *     enough" actually is. Same reasoning as the home-port sanctuary: an
 *     invisible circle that silently changes the rules is a bad circle.
 *
 * This is intentionally the simplest thing that reads correctly, not a look.
 * **Handoff to art-director:** an outpost should be a *place* — a fortified
 * harbour with a jetty, a stockade and a real banner that changes heraldry on
 * capture — and the capture itself deserves a moment (flag dropping, cannon
 * salute). None of that is here.
 */

const NEUTRAL = 0x9aa7b0;
const YOURS = 0x3ddc84;
const ENEMY = 0xff4d4d;

const DOCK_EXTRA = 18; // must match OUTPOST_DOCK_EXTRA in GameRoom.ts

interface Marker {
  group: THREE.Group;
  ring: THREE.Mesh;
  banner: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  bannerMat: THREE.MeshBasicMaterial;
}

export class OutpostMarkers {
  private markers = new Map<number, Marker>();
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  private build(info: OutpostInfo): Marker {
    const group = new THREE.Group();
    group.position.set(info.x, 0, info.z);

    const ringMat = new THREE.MeshBasicMaterial({
      color: NEUTRAL,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const dockR = info.radius + DOCK_EXTRA;
    const ring = new THREE.Mesh(new THREE.RingGeometry(dockR - 1.2, dockR, 64), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.35;
    group.add(ring);

    // Pole + banner, tall enough to clear the island terrain so ownership is
    // readable from open water rather than only once you're on top of it.
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.45, 26, 6),
      new THREE.MeshStandardMaterial({ color: 0x4a3b2a, roughness: 0.9 }),
    );
    pole.position.y = 13;
    group.add(pole);

    const bannerMat = new THREE.MeshBasicMaterial({ color: NEUTRAL, side: THREE.DoubleSide });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(7, 4), bannerMat);
    banner.position.set(3.5, 23, 0);
    group.add(banner);

    this.scene.add(group);
    return { group, ring, banner, ringMat, bannerMat };
  }

  sync(outposts: OutpostInfo[], elapsed: number) {
    const seen = new Set<number>();
    for (const info of outposts) {
      seen.add(info.islandIndex);
      let marker = this.markers.get(info.islandIndex);
      if (!marker) {
        marker = this.build(info);
        this.markers.set(info.islandIndex, marker);
      }
      const color = info.yours ? YOURS : info.ownerName ? ENEMY : NEUTRAL;
      marker.bannerMat.color.setHex(color);
      marker.ringMat.color.setHex(color);
      // A garrison is out: this island is a live fight right now.
      const contested = info.garrisonRemaining > 0;
      marker.ringMat.opacity = contested ? 0.3 + 0.35 * (0.5 + 0.5 * Math.sin(elapsed * 6)) : info.yours ? 0.4 : 0.22;
      marker.banner.rotation.y = Math.sin(elapsed * 1.4 + info.islandIndex) * 0.25;
    }
    for (const [index, marker] of this.markers) {
      if (seen.has(index)) continue;
      this.scene.remove(marker.group);
      this.markers.delete(index);
    }
  }

  clear() {
    for (const marker of this.markers.values()) this.scene.remove(marker.group);
    this.markers.clear();
  }
}
