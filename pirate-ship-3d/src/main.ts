import './style.css';
import * as THREE from 'three';
import { Ocean } from './game/Ocean';
import { Sky } from './game/Sky';
import { Ship, cannonMountOffsets } from './game/Ship';
import { World, buildCrateMesh } from './game/World';
import { TreasureMarker } from './game/TreasureMarker';
import { InputManager } from './game/Input';
import { Effects } from './game/Effects';
import { DamageNumbers } from './game/DamageNumbers';
import { SoundManager } from './game/Audio';
import { HUD } from './ui/HUD';
import { Chat } from './ui/Chat';
import { Tutorial } from './ui/Tutorial';
import { Minimap } from './ui/Minimap';
import { Network } from './net/Network';
import { SHIP_CLASS_SCALE, type CannonballSnapshot, type CrateInfo, type GameEvent, type ShipSnapshot } from './shared/protocol';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const portBtn = document.getElementById('port-btn') as HTMLButtonElement;
const muteBtn = document.getElementById('mute-btn') as HTMLButtonElement;
const joinScreen = document.getElementById('join-screen') as HTMLDivElement;
const joinName = document.getElementById('join-name') as HTMLInputElement;
const joinBtn = document.getElementById('join-btn') as HTMLButtonElement;
const joinStatus = document.getElementById('join-status') as HTMLParagraphElement;


// --- renderer / scene / camera -------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
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
// Sized to comfortably exceed the fog distance (950) in every direction from
// the player rather than to span the whole world — the mesh follows the
// player, so it only ever needs to cover what's actually visible. Ocean's
// constructor now packs vertex density toward the mesh centre (see WARP_POWER
// there), so 128 segments lands finer under the ship than the old uniform
// 256 did, while roughly halving total triangles by not wasting density on
// the outer band beyond the fog cutoff.
const ocean = new Ocean(2200, 128, sun.position);
scene.add(ocean.mesh);

// --- sky --------------------------------------------------------------------
// Horizon colour matches scene.fog so distant geometry dissolves into the
// sky rather than into a differently-coloured band.
const sky = new Sky(sun.position, 0xcfeaf6, 0x2f6fb5);
scene.add(sky.mesh);

let world: World | null = null;

// --- effects / sound ----------------------------------------------------
const effects = new Effects(scene);
const damageNumbers = new DamageNumbers(scene);
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
const tutorial = new Tutorial();
const minimap = new Minimap();
const network = new Network();
chat.onSend = (text) => network.sendChat(text);

const renderedShips = new Map<string, Ship>();
const renderedShipClass = new Map<string, ShipSnapshot['shipClass']>();
const renderedCrates = new Map<string, THREE.Mesh>();
const treasureMarker = new TreasureMarker(scene);

/** The server tracks cannonball flight authoritatively but previously never
 * got a visual — players only saw the muzzle flash and, moments later, the
 * splash/hit effect, with nothing in between showing where the shot went. */
interface CannonballVisual {
  group: THREE.Group;
  trail: THREE.Mesh;
  prevPos: THREE.Vector3;
}
const renderedCannonballs = new Map<string, CannonballVisual>();

function buildCannonballVisual(): CannonballVisual {
  const group = new THREE.Group();

  const ballGeo = new THREE.SphereGeometry(0.26, 10, 8);
  const ballMat = new THREE.MeshStandardMaterial({
    color: 0x1c1c1c,
    roughness: 0.35,
    metalness: 0.7,
    emissive: 0x3a1400,
    emissiveIntensity: 0.9,
  });
  const ball = new THREE.Mesh(ballGeo, ballMat);
  ball.castShadow = true;
  group.add(ball);

  // A short glowing streak behind the ball so its flight path reads clearly
  // even at 26 units/sec — oriented and scaled to its motion each frame.
  const trailGeo = new THREE.CylinderGeometry(0.05, 0.16, 1, 6, 1, true);
  const trailMat = new THREE.MeshBasicMaterial({
    color: 0xffb347,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const trail = new THREE.Mesh(trailGeo, trailMat);
  trail.visible = false;
  group.add(trail);

  return { group, trail, prevPos: new THREE.Vector3() };
}

function syncCannonballs(balls: CannonballSnapshot[]) {
  const seen = new Set<string>();
  for (const ball of balls) {
    seen.add(ball.id);
    const curPos = new THREE.Vector3(ball.x, ball.y, ball.z);
    let vis = renderedCannonballs.get(ball.id);
    if (!vis) {
      vis = buildCannonballVisual();
      vis.prevPos.copy(curPos);
      scene.add(vis.group);
      renderedCannonballs.set(ball.id, vis);
    }
    vis.group.position.copy(curPos);

    const delta = new THREE.Vector3().subVectors(curPos, vis.prevPos);
    const len = delta.length();
    if (len > 0.001) {
      vis.trail.visible = true;
      vis.trail.scale.set(1, Math.min(2.5, len * 3), 1);
      vis.trail.position.copy(delta).multiplyScalar(-0.5);
      vis.trail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
    }
    vis.prevPos.copy(curPos);
  }
  for (const [id, vis] of renderedCannonballs) {
    if (seen.has(id)) continue;
    scene.remove(vis.group);
    renderedCannonballs.delete(id);
  }
}

/** Distinct hull/sail palette for named rival captains — picked deterministically
 * from the name so the same captain always looks the same across sightings. */
const RIVAL_COLORS = [
  { hull: 0x2b1a3a, sail: 0x8a3fd6 },
  { hull: 0x1a2f3a, sail: 0x3fb8d6 },
  { hull: 0x3a2a1a, sail: 0xd68a3f },
  { hull: 0x1a3a22, sail: 0x3fd66b },
  { hull: 0x3a1a1a, sail: 0xd63f5a },
  { hull: 0x2a2a2a, sail: 0xd6d63f },
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function shipVisualOptions(isYou: boolean, ship: ShipSnapshot) {
  // Two masts and a galleon-shaped hull (stepped sterncastle, fuller beam)
  // for anything bigger than a sloop, so class reads structurally and not
  // just as "the same ship, larger."
  if (ship.isBoss) return { hullColor: 0x1c1712, sailColor: 0x6b1010, scale: 1.5, masts: 2 as const, hullClass: 2 as const };
  if (ship.isRival) {
    const c = RIVAL_COLORS[hashString(ship.name) % RIVAL_COLORS.length];
    return { hullColor: c.hull, sailColor: c.sail, scale: 1.2, masts: 2 as const, hullClass: 2 as const };
  }
  if (ship.isBot) return { hullColor: 0x4a3527, sailColor: 0x8b1e1e, scale: 0.9, masts: 1 as const, hullClass: 0 as const };

  const scale = SHIP_CLASS_SCALE[ship.shipClass];
  const masts: 1 | 2 = ship.shipClass === 'sloop' ? 1 : 2;
  const hullClass: 0 | 1 | 2 = ship.shipClass === 'sloop' ? 0 : ship.shipClass === 'brigantine' ? 1 : 2;
  // Slightly off-white canvas rather than near-pure white — the brighter
  // value clipped to a flat highlight under the sun and lost the billow.
  if (isYou) return { hullColor: 0x6b4a2c, sailColor: 0xd8cdb4, scale, masts, hullClass };
  return { hullColor: 0x6b4a2c, sailColor: 0x6ba8d6, scale, masts, hullClass };
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
  renderedShipClass.clear();
  for (const mesh of renderedCrates.values()) scene.remove(mesh);
  renderedCrates.clear();
  for (const vis of renderedCannonballs.values()) scene.remove(vis.group);
  renderedCannonballs.clear();
  treasureMarker.setTarget(null);
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
  // Same-host LAN play derives ws://<hostname>:8787 automatically; an
  // explicit ?ws=wss://... override lets the client be served from one
  // origin (e.g. a tunnel) while the game server lives on another.
  const override = new URLSearchParams(window.location.search).get('ws');
  const wsUrl = override ?? `ws://${window.location.hostname}:8787`;
  network.connect(wsUrl, name);
}
joinBtn.addEventListener('click', attemptJoin);
joinName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') attemptJoin();
});

network.onWelcome = (msg) => {
  clearWorldState();
  world = new World(scene, msg.islands);
  ocean.setIslands(msg.islands);
  joinScreen.classList.add('hidden');
  tutorial.showIfFirstVisit();
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
  treasureMarker.setTarget(state.you.treasureHunt);
};
network.onEvents = (events) => handleEvents(events);

// --- shipyard wiring ---------------------------------------------------
hud.onBuy = (key) => network.buyUpgrade(key);
hud.onSlotChange = (side, delta) => network.changeLoadout(side, delta);
hud.onBuyClass = () => network.buyShipClass();
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

// A brief near-freeze on cannonball impact so a hit reads as a real event
// instead of just a particle burst — purely a rendering-side slowdown of
// this frame's dt (input still sends every frame, so it never adds lag).
let hitstopTimer = 0;
function triggerHitstop(duration: number) {
  hitstopTimer = Math.max(hitstopTimer, duration);
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
      if (ev.shipId === network.yourId) triggerShake(0.1, 0.12);
    } else if (ev.type === 'splash') {
      effects.splash(new THREE.Vector3(ev.x, ev.y, ev.z));
    } else if (ev.type === 'hit') {
      effects.impactSplinters(new THREE.Vector3(ev.x, ev.y, ev.z));
      sound.hitImpact();
      renderedShips.get(ev.targetId)?.flashHit();
      const dealt = ev.ownerId === network.yourId;
      const taken = ev.targetId === network.yourId;
      damageNumbers.spawn(new THREE.Vector3(ev.x, ev.y, ev.z), ev.damage, dealt);
      triggerHitstop(taken ? 0.07 : 0.05);
      if (taken) {
        flashDamage();
        triggerShake(0.35, 0.4);
      } else if (dealt) {
        triggerShake(0.15, 0.18);
      }
    } else if (ev.type === 'ram') {
      effects.hullCrunch(new THREE.Vector3(ev.x, ev.y, ev.z));
      sound.ramImpact();
    } else if (ev.type === 'sunk') {
      effects.sinkExplosion(new THREE.Vector3(ev.x, 0, ev.z));
      sound.sink();
      triggerHitstop(0.09);
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
  let dt = Math.min(clock.getDelta(), 0.05);
  if (hitstopTimer > 0) {
    hitstopTimer = Math.max(0, hitstopTimer - dt);
    dt *= 0.08;
  }
  elapsed += dt;
  ocean.update(elapsed);
  sky.update(elapsed);
  effects.update(dt);
  damageNumbers.update(dt);
  for (const mesh of renderedCrates.values()) {
    const h = ocean.getHeightAt(mesh.position.x, mesh.position.z, elapsed);
    mesh.position.y = h + 0.3;
    mesh.rotation.y = elapsed * 0.6;
  }
  const treasureH = ocean.getHeightAt(treasureMarker.group.position.x, treasureMarker.group.position.z, elapsed);
  treasureMarker.update(dt, elapsed, treasureH);

  input.update();

  let mine: ShipSnapshot | undefined;
  let myShip: Ship | undefined;

  if (network.yourId && world) {
    const suppressInput = hud.isShipyardOpen() || chat.isOpen() || tutorial.isOpen();
    const activeInput = suppressInput ? { turn: 0, throttle: 0, fire: false, boost: false } : input.state;
    network.sendInput(activeInput);

    const snapshot = network.getRenderShips();
    const seenIds = new Set<string>();

    syncCannonballs(network.getRenderCannonballs());

    for (const cur of snapshot) {
      seenIds.add(cur.id);
      const isYou = cur.id === network.yourId;

      let ship = renderedShips.get(cur.id);
      if (ship && renderedShipClass.get(cur.id) !== cur.shipClass) {
        scene.remove(ship.group);
        ship = undefined;
      }
      if (!ship) {
        ship = new Ship(
          { sailLevel: 0, cannonLevel: 0, hullLevel: 0 },
          { ...shipVisualOptions(isYou, cur), loadout: cur.loadout },
        );
        scene.add(ship.group);
        renderedShips.set(cur.id, ship);
        renderedShipClass.set(cur.id, cur.shipClass);
      }

      if (!sameLoadout(ship.loadout, cur.loadout)) ship.setLoadout(cur.loadout);

      ship.position.set(cur.x, 0, cur.z);
      ship.heading = cur.heading;
      ship.speed = cur.speed;
      ship.health = cur.health;
      ship.maxHealth = cur.maxHealth;
      ship.alive = cur.alive;
      ship.setStatusEffects(cur.sailDisabled, cur.burning);
      if (cur.alive) ship.resetSink();
      else ship.beginSinking();

      ship.updateSink(dt);
      ship.updateHitFlash(dt, elapsed);
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
      renderedShipClass.delete(id);
    }

    if (mine) {
      minimap.render(
        mine.x,
        mine.z,
        mine.heading,
        world.islands.map((isl) => ({ x: isl.position.x, z: isl.position.z, radius: isl.radius, isHomePort: isl.isHomePort })),
        snapshot,
        network.yourId,
      );
    }
  }

  if (mine && myShip) {
    ocean.followTarget(mine.x, mine.z);
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

  // After all camera movement (including shake) has settled, so the dome
  // stays exactly centred on the viewer.
  sky.followTarget(camera.position.x, camera.position.y, camera.position.z);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
