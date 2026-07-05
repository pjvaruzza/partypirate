import './style.css';
import * as THREE from 'three';
import { Ocean } from './game/Ocean';
import { Ship } from './game/Ship';
import { World } from './game/World';
import { InputManager } from './game/Input';
import { CombatSystem, type EnemyShip } from './game/Combat';
import { Economy } from './game/Economy';
import { Effects } from './game/Effects';
import { SoundManager } from './game/Audio';
import { HUD } from './ui/HUD';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const portBtn = document.getElementById('port-btn') as HTMLButtonElement;
const muteBtn = document.getElementById('mute-btn') as HTMLButtonElement;

const WORLD_RADIUS = 900;
const MAX_ENEMIES = 6;
const BOOST_DURATION = 4;
const BOOST_RECHARGE_TIME = 12;

function createSkyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#3f7fc4');
  gradient.addColorStop(0.55, '#9fd8f0');
  gradient.addColorStop(1, '#e3f5fb');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 2, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// --- renderer / scene / camera -------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = createSkyTexture();
scene.fog = new THREE.Fog(0xcfeaf6, 200, 950);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// --- lighting -------------------------------------------------------------
const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
sun.position.set(120, 200, 80);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -200;
sun.shadow.camera.right = 200;
sun.shadow.camera.top = 200;
sun.shadow.camera.bottom = -200;
scene.add(sun);
scene.add(new THREE.AmbientLight(0xbcd9ff, 0.7));
scene.add(new THREE.HemisphereLight(0xdfefff, 0x1c3d2a, 0.5));

// --- world ------------------------------------------------------------------
const ocean = new Ocean(WORLD_RADIUS * 2.4);
scene.add(ocean.mesh);

const world = new World(scene, 12, WORLD_RADIUS);

// --- effects / sound ----------------------------------------------------
const effects = new Effects(scene);
const sound = new SoundManager();
function unlockAudio() {
  sound.resume();
  window.removeEventListener('pointerdown', unlockAudio);
  window.removeEventListener('keydown', unlockAudio);
}
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

let muted = false;
muteBtn?.addEventListener('click', () => {
  muted = !muted;
  sound.setMuted(muted);
  muteBtn.textContent = muted ? '🔇' : '🔊';
});

// --- economy / player ship -----------------------------------------------
const economy = new Economy();
const hud = new HUD(economy);

const player = new Ship(economy.shipStats(), {
  hullColor: 0x6b4a2c,
  sailColor: 0xf2ead6,
  scale: 1,
  loadout: economy.loadout(),
});
player.position.set(0, 0, 45);
player.heading = Math.PI;
scene.add(player.group);

let boostCharge = economy.powderKegCharges();
let boosting = false;
let boostTimer = 0;
let boostRechargeTimer = 0;

// --- combat -----------------------------------------------------------------
const combat = new CombatSystem(
  scene,
  {
    onPlayerHit: () => {
      hud.setHealth(player.health, player.maxHealth);
      flashDamage();
      triggerShake(0.35, 0.4);
    },
    onEnemySunk: (enemy: EnemyShip) => {
      economy.addGold(enemy.goldReward);
      hud.showMessage(`Enemy sunk! +${enemy.goldReward} gold`);
    },
    onGoldEarned: () => {},
  },
  effects,
  sound,
);

function spawnEnemyWave() {
  if (combat.enemies.length >= MAX_ENEMIES) return;
  const angle = Math.random() * Math.PI * 2;
  const dist = 120 + Math.random() * (WORLD_RADIUS - 150);
  const pos = new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
  const tier = Math.min(4, Math.floor(dist / 220));
  const stats = { sailLevel: tier, cannonLevel: tier, hullLevel: tier };
  const reward = 25 + tier * 20;
  combat.spawnEnemy(stats, pos, reward);
}
for (let i = 0; i < 4; i++) spawnEnemyWave();
setInterval(spawnEnemyWave, 8000);

// --- input ------------------------------------------------------------------
const input = new InputManager();

// --- camera rig ---------------------------------------------------------
const cameraOffset = new THREE.Vector3(0, 7, 13);
const cameraTarget = new THREE.Vector3();

// --- damage flash -------------------------------------------------------
let damageFlash = 0;
function flashDamage() {
  damageFlash = 1;
}

// --- screen shake ---------------------------------------------------------
let shakeTimeLeft = 0;
let shakeDuration = 0;
let shakeMagnitude = 0;
function triggerShake(duration: number, magnitude: number) {
  shakeTimeLeft = duration;
  shakeDuration = duration;
  shakeMagnitude = magnitude;
}

// --- respawn ---------------------------------------------------------------
let isSunk = false;
function respawn() {
  player.health = player.maxHealth;
  player.alive = true;
  player.resetSink();
  player.position.set(0, 0, 45);
  player.heading = Math.PI;
  player.speed = 0;
  isSunk = false;
  hud.setHealth(player.health, player.maxHealth);
  hud.showMessage('Rescued! Back at port.', 2500);
}

// --- shipyard wiring ---------------------------------------------------
hud.onBuy = (key) => {
  if (economy.buy(key)) {
    player.stats = economy.shipStats();
    player.health = Math.min(player.health, player.maxHealth);
    if (key === 'hull') player.health = player.maxHealth;
    if (key === 'powder') boostCharge = economy.powderKegCharges();
    hud.refreshShipyard();
    hud.setHealth(player.health, player.maxHealth);
  }
};
hud.onLoadoutChange = () => {
  player.setLoadout(economy.loadout());
};
hud.onShipyardClose = () => {};
portBtn.addEventListener('click', () => {
  if (!hud.isShipyardOpen()) hud.showShipyard();
});

hud.setHealth(player.health, player.maxHealth);
hud.setGold(economy.state.gold);

// --- main loop ---------------------------------------------------------
const clock = new THREE.Clock();
let elapsed = 0;

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  ocean.update(elapsed);
  world.update(elapsed, (x, z) => ocean.getHeightAt(x, z, elapsed));
  effects.update(dt);

  input.update();
  const shipyardOpen = hud.isShipyardOpen();

  if (!shipyardOpen && player.alive) {
    // boost handling
    if (boostTimer > 0) {
      boostTimer -= dt;
      boosting = true;
      if (boostTimer <= 0) boosting = false;
    } else if (input.state.boost && boostCharge >= 1) {
      boostCharge -= 1;
      boostTimer = BOOST_DURATION;
      boosting = true;
    }
    if (!boosting && boostCharge < economy.powderKegCharges()) {
      boostRechargeTimer += dt;
      if (boostRechargeTimer >= BOOST_RECHARGE_TIME) {
        boostRechargeTimer = 0;
        boostCharge = Math.min(economy.powderKegCharges(), boostCharge + 1);
      }
    }

    player.applyControls(input.state.turn, input.state.throttle, dt, boosting);
    const prevPos = player.position.clone();
    player.integrate(dt);
    resolveIslandCollisions(player, prevPos);

    if (input.state.fire) {
      combat.fireFromShip(player, 'player');
    }
    player.cannonCooldown = Math.max(0, player.cannonCooldown - dt);

    combat.update(dt, player, (x, z) => ocean.getHeightAt(x, z, elapsed));

    // gold pickups
    for (const crate of world.crates) {
      if (crate.collected) continue;
      if (crate.position.distanceTo(player.position) < 3.2) {
        world.collectCrate(crate);
        economy.addGold(crate.value);
        hud.showMessage(`+${crate.value} gold`, 1200);
        hud.setGold(economy.state.gold);
        setTimeout(() => world.spawnOneCrate(WORLD_RADIUS), 15000);
      }
    }
    hud.setGold(economy.state.gold);

    if (!player.alive && !isSunk) {
      isSunk = true;
      hud.showMessage('Your ship has sunk!', 3000);
      setTimeout(respawn, 3000);
    }

    // shipyard prompt
    const nearPort = world.isNearHomePort(player.position);
    portBtn.classList.toggle('hidden', !nearPort);
  } else {
    portBtn.classList.add('hidden');
  }

  player.updateSink(dt);
  player.updateHitFlash(dt);
  const waveH = ocean.getHeightAt(player.position.x, player.position.z, elapsed);
  player.syncVisual(waveH, elapsed);

  // camera follow
  const behind = player.forwardDirection().multiplyScalar(-1);
  const desiredCamPos = player.group.position
    .clone()
    .addScaledVector(behind, cameraOffset.z)
    .add(new THREE.Vector3(0, cameraOffset.y, 0));
  camera.position.lerp(desiredCamPos, 1 - Math.pow(0.001, dt));
  cameraTarget.lerp(player.group.position, 1 - Math.pow(0.0005, dt));
  camera.lookAt(cameraTarget.x, cameraTarget.y + 1.5, cameraTarget.z);

  if (shakeTimeLeft > 0) {
    shakeTimeLeft = Math.max(0, shakeTimeLeft - dt);
    const s = shakeMagnitude * (shakeTimeLeft / shakeDuration);
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
  }

  if (damageFlash > 0) damageFlash = Math.max(0, damageFlash - dt * 2);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function resolveIslandCollisions(ship: Ship, prevPos: THREE.Vector3) {
  for (const island of world.islands) {
    const toShip = new THREE.Vector3().subVectors(ship.position, island.position);
    toShip.y = 0;
    const dist = toShip.length();
    const minDist = island.radius + 2.5;
    if (dist < minDist) {
      if (dist < 0.001) {
        ship.position.copy(prevPos);
      } else {
        toShip.normalize();
        ship.position.copy(island.position).addScaledVector(toShip, minDist);
      }
      ship.speed *= 0.2;
    }
  }
}

requestAnimationFrame(animate);
