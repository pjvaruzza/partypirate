import './style.css';
import * as THREE from 'three';
import { Ocean } from './game/Ocean';
import { Ship, cannonMountOffsets } from './game/Ship';
import { World, buildCrateMesh } from './game/World';
import { InputManager } from './game/Input';
import { Effects } from './game/Effects';
import { SoundManager } from './game/Audio';
import { HUD } from './ui/HUD';
import { Chat } from './ui/Chat';
import { Network } from './net/Network';
import type { CrateInfo, GameEvent, ShipSnapshot } from './shared/protocol';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const portBtn = document.getElementById('port-btn') as HTMLButtonElement;
const muteBtn = document.getElementById('mute-btn') as HTMLButtonElement;
const joinScreen = document.getElementById('join-screen') as HTMLDivElement;
const joinName = document.getElementById('join-name') as HTMLInputElement;
const joinBtn = document.getElementById('join-btn') as HTMLButtonElement;
const joinStatus = document.getElementById('join-status') as HTMLParagraphElement;

const WORLD_RADIUS = 900;

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

// --- ocean ------------------------------------------------------------------
const ocean = new Ocean(WORLD_RADIUS * 2.4);
scene.add(ocean.mesh);

let world: World | null = null;

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

// --- HUD / chat / network ----------------------------------------------------
const hud = new HUD();
const chat = new Chat();
const network = new Network();
chat.onSend = (text) => network.sendChat(text);

const renderedShips = new Map<string, Ship>();
const renderedCrates = new Map<string, THREE.Mesh>();

function shipVisualOptions(isYou: boolean, isBot: boolean) {
  if (isYou) return { hullColor: 0x6b4a2c, sailColor: 0xf2ead6, scale: 1 };
  if (isBot) return { hullColor: 0x4a3527, sailColor: 0x8b1e1e, scale: 0.9 };
  return { hullColor: 0x6b4a2c, sailColor: 0x6ba8d6, scale: 1 };
}

function sameLoadout(a: ShipSnapshot['loadout'], b: ShipSnapshot['loadout']): boolean {
  return a.front === b.front && a.left === b.left && a.right === b.right;
}

function syncCrates(crates: CrateInfo[]) {
  const seen = new Set<string>();
  for (const crate of crates) {
    seen.add(crate.id);
    if (renderedCrates.has(crate.id)) continue;
    const mesh = buildCrateMesh();
    mesh.position.set(crate.x, 0, crate.z);
    scene.add(mesh);
    renderedCrates.set(crate.id, mesh);
  }
  for (const [id, mesh] of renderedCrates) {
    if (seen.has(id)) continue;
    scene.remove(mesh);
    renderedCrates.delete(id);
  }
}

function clearWorldState() {
  for (const ship of renderedShips.values()) scene.remove(ship.group);
  renderedShips.clear();
  for (const mesh of renderedCrates.values()) scene.remove(mesh);
  renderedCrates.clear();
  world = null;
}

// --- join screen --------------------------------------------------------
function attemptJoin() {
  const name = joinName.value.trim();
  if (!name) {
    joinStatus.textContent = 'Enter a captain name first.';
    return;
  }
  joinBtn.disabled = true;
  joinStatus.textContent = 'Connecting…';
  const wsUrl = `ws://${window.location.hostname}:8787`;
  network.connect(wsUrl, name);
}
joinBtn.addEventListener('click', attemptJoin);
joinName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') attemptJoin();
});

network.onWelcome = (msg) => {
  clearWorldState();
  world = new World(scene, msg.islands);
  joinScreen.classList.add('hidden');
};
network.onDisconnect = () => {
  clearWorldState();
  joinScreen.classList.remove('hidden');
  joinBtn.disabled = false;
  joinStatus.textContent = 'Disconnected — check the server and try again.';
};
network.onState = (state) => {
  hud.updateEconomy(state.you);
  syncCrates(state.crates);
};
network.onEvents = (events) => handleEvents(events);

// --- shipyard wiring ---------------------------------------------------
hud.onBuy = (key) => network.buyUpgrade(key);
hud.onSlotChange = (side, delta) => network.changeLoadout(side, delta);
hud.onShipyardClose = () => {};
portBtn.addEventListener('click', () => {
  if (!hud.isShipyardOpen()) hud.showShipyard();
});

// --- input ------------------------------------------------------------------
const input = new InputManager();

// --- camera rig ---------------------------------------------------------
const cameraOffset = new THREE.Vector3(0, 7, 13);
const cameraTarget = new THREE.Vector3();

// --- damage flash / screen shake -----------------------------------------
let damageFlash = 0;
function flashDamage() {
  damageFlash = 1;
}

let shakeTimeLeft = 0;
let shakeDuration = 0;
let shakeMagnitude = 0;
function triggerShake(duration: number, magnitude: number) {
  shakeTimeLeft = duration;
  shakeDuration = duration;
  shakeMagnitude = magnitude;
}

// --- server-driven juice: fire/splash/hit/sunk/message events -----------
function handleEvents(events: GameEvent[]) {
  for (const ev of events) {
    if (ev.type === 'fire') {
      const ship = renderedShips.get(ev.shipId);
      if (!ship) continue;
      const count = ship.loadout[ev.side];
      if (count <= 0) continue;
      const forward = ship.forwardDirection();
      const right = new THREE.Vector3(forward.z, 0, -forward.x);
      const dir = ev.side === 'front' ? forward : ev.side === 'left' ? right : right.clone().multiplyScalar(-1);
      const origin = ship.position.clone().add(new THREE.Vector3(0, 1.2, 0));
      for (const offset of cannonMountOffsets(ev.side, count, ship.scale)) {
        const worldOffset = forward.clone().multiplyScalar(offset.z).add(right.clone().multiplyScalar(offset.x));
        effects.muzzleFlash(origin.clone().add(worldOffset), dir);
      }
      sound.cannonFire();
    } else if (ev.type === 'splash') {
      effects.splash(new THREE.Vector3(ev.x, ev.y, ev.z));
    } else if (ev.type === 'hit') {
      effects.impactSplinters(new THREE.Vector3(ev.x, ev.y, ev.z));
      sound.hitImpact();
      renderedShips.get(ev.targetId)?.flashHit();
      if (ev.targetId === network.yourId) {
        flashDamage();
        triggerShake(0.35, 0.4);
      }
    } else if (ev.type === 'sunk') {
      effects.sinkExplosion(new THREE.Vector3(ev.x, 0, ev.z));
      sound.sink();
    } else if (ev.type === 'message') {
      hud.showMessage(ev.text, ev.duration);
    } else if (ev.type === 'chat') {
      chat.addMessage(ev.name, ev.text);
    }
  }
}

// --- main loop ---------------------------------------------------------
const clock = new THREE.Clock();
let elapsed = 0;

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  ocean.update(elapsed);
  effects.update(dt);
  for (const mesh of renderedCrates.values()) {
    const h = ocean.getHeightAt(mesh.position.x, mesh.position.z, elapsed);
    mesh.position.y = h + 0.3;
    mesh.rotation.y = elapsed * 0.6;
  }

  input.update();

  let mine: ShipSnapshot | undefined;
  let myShip: Ship | undefined;

  if (network.yourId && world) {
    const suppressInput = hud.isShipyardOpen() || chat.isOpen();
    const activeInput = suppressInput ? { turn: 0, throttle: 0, fire: false, boost: false } : input.state;
    network.sendInput(activeInput);

    const snapshot = network.getRenderShips();
    const seenIds = new Set<string>();

    for (const cur of snapshot) {
      seenIds.add(cur.id);
      const isYou = cur.id === network.yourId;

      let ship = renderedShips.get(cur.id);
      if (!ship) {
        ship = new Ship(
          { sailLevel: 0, cannonLevel: 0, hullLevel: 0 },
          { ...shipVisualOptions(isYou, cur.isBot), loadout: cur.loadout },
        );
        scene.add(ship.group);
        renderedShips.set(cur.id, ship);
      }

      if (!sameLoadout(ship.loadout, cur.loadout)) ship.setLoadout(cur.loadout);

      ship.position.set(cur.x, 0, cur.z);
      ship.heading = cur.heading;
      ship.speed = cur.speed;
      ship.health = cur.health;
      ship.maxHealth = cur.maxHealth;
      ship.alive = cur.alive;
      if (cur.alive) ship.resetSink();
      else ship.beginSinking();

      ship.updateSink(dt);
      ship.updateHitFlash(dt);
      const h = ocean.getHeightAt(cur.x, cur.z, elapsed);
      ship.syncVisual(h, elapsed);

      if (isYou) {
        mine = cur;
        myShip = ship;
      }
    }

    for (const [id, ship] of renderedShips) {
      if (seenIds.has(id)) continue;
      scene.remove(ship.group);
      renderedShips.delete(id);
    }
  }

  if (mine && myShip) {
    hud.setHealth(mine.health, mine.maxHealth);
    const nearPort = world!.isNearHomePort(new THREE.Vector3(mine.x, 0, mine.z));
    portBtn.classList.toggle('hidden', !nearPort);

    const behind = myShip.forwardDirection().multiplyScalar(-1);
    const desiredCamPos = myShip.group.position
      .clone()
      .addScaledVector(behind, cameraOffset.z)
      .add(new THREE.Vector3(0, cameraOffset.y, 0));
    camera.position.lerp(desiredCamPos, 1 - Math.pow(0.001, dt));
    cameraTarget.lerp(myShip.group.position, 1 - Math.pow(0.0005, dt));
    camera.lookAt(cameraTarget.x, cameraTarget.y + 1.5, cameraTarget.z);
  } else {
    portBtn.classList.add('hidden');
  }

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

requestAnimationFrame(animate);
