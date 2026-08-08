import * as THREE from 'three';

interface DamageNumber {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

function buildTexture(text: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const LIFE = 0.9;

/** Floating "-12" style text that pops up where a cannonball lands, so a hit
 * reads as a concrete amount of damage instead of just a particle burst. */
export class DamageNumbers {
  private scene: THREE.Scene;
  private numbers: DamageNumber[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  spawn(position: THREE.Vector3, amount: number, dealt: boolean) {
    const color = dealt ? '#ffd23f' : '#ff5b4d';
    const texture = buildTexture(`-${Math.round(amount)}`, color);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(material);
    const scale = dealt ? 1.5 : 1.9;
    sprite.scale.set(scale, scale * 0.5, 1);
    sprite.position.copy(position).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 1, (Math.random() - 0.5) * 0.6));
    sprite.renderOrder = 10;
    this.scene.add(sprite);

    this.numbers.push({
      sprite,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.6, (Math.random() - 0.5) * 0.4),
      life: LIFE,
      maxLife: LIFE,
    });
  }

  update(dt: number) {
    for (const n of this.numbers) {
      n.life -= dt;
      n.velocity.y -= dt * 1.2;
      n.sprite.position.addScaledVector(n.velocity, dt);
      const material = n.sprite.material as THREE.SpriteMaterial;
      material.opacity = Math.max(0, n.life / n.maxLife);
    }
    for (const n of this.numbers) {
      if (n.life <= 0) {
        this.scene.remove(n.sprite);
        (n.sprite.material as THREE.SpriteMaterial).map?.dispose();
        (n.sprite.material as THREE.SpriteMaterial).dispose();
      }
    }
    this.numbers = this.numbers.filter((n) => n.life > 0);
  }
}
