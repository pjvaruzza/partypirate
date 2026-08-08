import './style.css';
import * as THREE from 'three';
import { Ocean } from './game/Ocean';
import { Sky } from './game/Sky';
import { Ship, cannonMountOffsets } from './game/Ship';
import { hashString, shipVisualOptions } from './game/Livery';
import {
  buildSalvageMarker,
  buildWardMarker,
  updateSalvageMarker,
  updateWardMarkers,
  type SalvageVisual,
  type WardVisual,
} from './game/Markers';
import { World, buildCrateMesh } from './game/World';
import { TreasureMarker } from './game/TreasureMarker';
import { OutpostMarkers } from './game/OutpostMarkers';
import { InputManager } from './game/Input';
import { Effects } from './game/Effects';
import { DamageNumbers } from './game/DamageNumbers';
import { SoundManager } from './game/Audio';
import { HUD } from './ui/HUD';
import { Chat } from './ui/Chat';
import { Tutorial } from './ui/Tutorial';
import { Minimap } from './ui/Minimap';
import { Network } from './net/Network';
import {
  type CannonballSnapshot,
  type CrateInfo,
  type GameEvent,
  type SalvageInfo,
  type ShipSnapshot,
} from './shared/protocol';

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
// The sky/fog colours are handed to the ocean too: its fresnel reflection is
// evaluated against the same gradient the skydome draws, so the water and the
// sky above it can never disagree about what's being reflected.
const SKY_HORIZON = 0xcfeaf6;
const SKY_ZENITH = 0x2f6fb5;
const ocean = new Ocean(2200, 128, sun.position, {
  horizonColor: SKY_HORIZON,
  zenithColor: SKY_ZENITH,
  fogColor: SKY_HORIZON,
  fogNear: 200,
  fogFar: 950,
});
scene.add(ocean.mesh);

// --- sky --------------------------------------------------------------------
// Horizon colour matches scene.fog so distant geometry dissolves into the
// sky rather than into a differently-coloured band.
const sky = new Sky(sun.position, SKY_HORIZON, SKY_ZENITH);
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
  muteBtn.classList.toggle('muted', muted);
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
const outpostMarkers = new OutpostMarkers(scene);

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

function sameLoadout(a: ShipSnapshot['loadout'], b: ShipSnapshot['loadout']): boolean {
  return a.front === b.front && a.left === b.left && a.right === b.right;
}

/** Spilled hold gold. The visual lives in game/Markers.ts — see the note there
 * on why the old additive disc had to go. */
const renderedSalvage = new Map<string, { vis: SalvageVisual; phase: number }>();

function syncSalvage(piles: SalvageInfo[]) {
  const seen = new Set<string>();
  for (const pile of piles) {
    seen.add(pile.id);
    if (renderedSalvage.has(pile.id)) continue;
    const vis = buildSalvageMarker();
    vis.group.position.set(pile.x, 0, pile.z);
    scene.add(vis.group);
    renderedSalvage.set(pile.id, { vis, phase: hashString(pile.id) % 628 / 100 });
  }
  for (const [id, entry] of renderedSalvage) {
    if (seen.has(id)) continue;
    scene.remove(entry.vis.group);
    renderedSalvage.delete(id);
  }
}

/** Harbour ward under any ship that currently can't deal or take damage (in
 * the port sanctuary, freshly respawned, or a disconnected ghost). Without it
 * a player just watches their broadsides pass harmlessly through someone with
 * no explanation. Visual in game/Markers.ts. */
const renderedProtectRings = new Map<string, WardVisual>();

function syncProtectionRing(id: string, ship: ShipSnapshot, y: number) {
  const want = ship.protectedFromDamage && ship.alive;
  const existing = renderedProtectRings.get(id);
  if (!want) {
    if (existing) {
      scene.remove(existing.group);
      renderedProtectRings.delete(id);
    }
    return;
  }
  let ward = existing;
  if (!ward) {
    ward = buildWardMarker();
    scene.add(ward.group);
    renderedProtectRings.set(id, ward);
  }
  ward.group.position.set(ship.x, y + 0.08, ship.z);
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
  for (const ship of renderedShips.values()) {
    scene.remove(ship.group);
    ship.dispose();
  }
  renderedShips.clear();
  renderedShipClass.clear();
  for (const mesh of renderedCrates.values()) scene.remove(mesh);
  renderedCrates.clear();
  for (const entry of renderedSalvage.values()) scene.remove(entry.vis.group);
  renderedSalvage.clear();
  for (const ward of renderedProtectRings.values()) scene.remove(ward.group);
  renderedProtectRings.clear();
  for (const vis of renderedCannonballs.values()) scene.remove(vis.group);
  renderedCannonballs.clear();
  treasureMarker.setTarget(null);
  outpostMarkers.clear();
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
  // Don't stack the ammo coach mark on top of the tutorial overlay — it
  // waits for the tutorial to be dismissed (see tutorial.onClose below).
  if (!tutorial.isOpen()) input.ammoRack.showCoachIfFirstVisit();
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
  syncSalvage(state.salvage);
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
  // Don't let the button hold keyboard focus: Space is the fire key, and a
  // focused <button> treats Space as "activate", which would silently
  // reopen the shipyard mid-combat after it's closed (see c9fc634 follow-up).
  portBtn.blur();
});

// --- input ------------------------------------------------------------------
const input = new InputManager();
tutorial.onClose = () => input.ammoRack.showCoachIfFirstVisit();

// --- camera rig ---------------------------------------------------------
// Was (0, 7, 13), i.e. looking down at the ship at ~23°. At that pitch a hull
// 4 units long and ~1.4 deep projects its 4-unit deck plan almost in full and
// its hull side down to a ~0.3-unit sliver — a 12:1 ratio, which is why the
// ship read as an open dish you're staring into rather than a vessel. 5.2/13
// is ~16°, roughly halving the deck's share and doubling the hull side's,
// without meaningfully costing forward visibility (the ship also ends up
// marginally closer to the camera, so it isn't any smaller on screen).
const cameraOffset = new THREE.Vector3(0, 5.2, 13);
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
      // Defensive: guarantees the burn loop can't outlive the ship even if
      // a snapshot with `burning: false` never arrives before the socket
      // drops (e.g. this was the local player's own death).
      if (ev.shipId === network.yourId) sound.setBurning(false);
      triggerHitstop(0.09);
    } else if (ev.type === 'banked') {
      // Distinct from a 'gold' pickup: this is the moment the hold becomes
      // permanent — the resolution of a whole voyage. Still needs its own
      // sound cue (flagged to sound-design).
      hud.flashBanked(ev.amount);
    } else if (ev.type === 'message') {
      hud.showMessage(ev.text, ev.duration);
    } else if (ev.type === 'chat') {
      chat.addMessage(ev.name, ev.text);
    }
  }
}

// --- ship wakes -------------------------------------------------------
// The ocean draws wakes analytically in its fragment shader (no spawned
// meshes, no particles), so all it needs each frame is where the fastest few
// ships are and which way they're pointing. Only the nearest handful get one:
// a wake 400 units away is a couple of pixels wide, and the fragment loop is
// the one place ocean cost scales with ship count.
// Roughly a fresh sloop's top speed (ShipSim.topSpeed's base of 9), so a
// starting ship at full sail already gets a full-strength wake and upgraded
// hulls saturate rather than scaling past it.
const WAKE_SPEED_REFERENCE = 9;
interface WakeCandidate { d: number; x: number; z: number; fx: number; fz: number; s: number }
const wakeSlots: WakeCandidate[] = Array.from({ length: 6 }, () => ({ d: 0, x: 0, z: 0, fx: 0, fz: 1, s: 0 }));
let wakeSlotCount = 0;

function feedWakes(snapshot: ShipSnapshot[]) {
  wakeSlotCount = 0;
  for (const s of snapshot) {
    if (!s.alive) continue;
    const speed01 = Math.min(1, Math.abs(s.speed) / WAKE_SPEED_REFERENCE);
    if (speed01 < 0.08) continue;
    const dx = s.x - camera.position.x;
    const dz = s.z - camera.position.z;
    const d = dx * dx + dz * dz;
    // Insertion sort into a fixed-size nearest-first buffer — no allocation,
    // and the buffer is 6 long so this is a handful of comparisons.
    let slot = wakeSlotCount < wakeSlots.length ? wakeSlotCount++ : -1;
    if (slot < 0) {
      let worst = 0;
      for (let i = 1; i < wakeSlots.length; i++) if (wakeSlots[i].d > wakeSlots[worst].d) worst = i;
      if (wakeSlots[worst].d <= d) continue;
      slot = worst;
    }
    const w = wakeSlots[slot];
    w.d = d;
    w.x = s.x;
    w.z = s.z;
    // Reversing ships still push water the way they're pointed; the wake
    // trails away from the direction of travel, hence the sign of speed.
    const sign = s.speed < 0 ? -1 : 1;
    w.fx = Math.sin(s.heading) * sign;
    w.fz = Math.cos(s.heading) * sign;
    w.s = speed01;
  }
  ocean.beginWakes();
  for (let i = 0; i < wakeSlotCount; i++) {
    const w = wakeSlots[i];
    ocean.addWake(w.x, w.z, w.fx, w.fz, w.s);
  }
  ocean.endWakes();
}

// --- main loop ---------------------------------------------------------
const clock = new THREE.Clock();
let elapsed = 0;

/** Wave-height sampler handed to Ship.syncVisual so each hull can ride the
 * chord between its own bow and stern rather than sitting flat at its centre
 * height. Allocated once, with the time captured through a mutable module
 * variable, so the render loop stays allocation-free. */
let waveSampleTime = 0;
const waveAt = (x: number, z: number) => ocean.getHeightAt(x, z, waveSampleTime);

function animate() {
  let dt = Math.min(clock.getDelta(), 0.05);
  if (hitstopTimer > 0) {
    hitstopTimer = Math.max(0, hitstopTimer - dt);
    dt *= 0.08;
  }
  elapsed += dt;
  waveSampleTime = elapsed;
  ocean.update(elapsed);
  sky.update(elapsed);
  effects.update(dt);
  damageNumbers.update(dt);
  for (const mesh of renderedCrates.values()) {
    const h = ocean.getHeightAt(mesh.position.x, mesh.position.z, elapsed);
    mesh.position.y = h + 0.3;
    mesh.rotation.y = elapsed * 0.6;
  }
  for (const entry of renderedSalvage.values()) {
    const g = entry.vis.group;
    g.position.y = ocean.getHeightAt(g.position.x, g.position.z, elapsed);
    // Debris lolls with the swell rather than spinning like a pickup icon.
    g.rotation.z = Math.sin(elapsed * 1.1 + entry.phase) * 0.09;
    g.rotation.x = Math.sin(elapsed * 0.83 + entry.phase * 1.7) * 0.07;
    updateSalvageMarker(entry.vis, elapsed, entry.phase);
  }
  updateWardMarkers(elapsed);
  const treasureH = ocean.getHeightAt(treasureMarker.group.position.x, treasureMarker.group.position.z, elapsed);
  treasureMarker.update(dt, elapsed, treasureH);
  outpostMarkers.sync(network.state?.outposts ?? [], elapsed);

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
        ship.dispose();
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
      // Only the local ship's burn state drives audio — every burning ship
      // in a fight would mean one extra looping voice per ship, which is
      // exactly the "dozens of simultaneous oscillator graphs" mobile-audio
      // constraint this file is meant to avoid.
      if (isYou) sound.setBurning(cur.burning);
      if (cur.alive) ship.resetSink();
      else ship.beginSinking();

      ship.updateSink(dt);
      ship.updateHitFlash(dt, elapsed);
      const h = ocean.getHeightAt(cur.x, cur.z, elapsed);
      ship.syncVisual(h, elapsed, waveAt);
      syncProtectionRing(cur.id, cur, h);

      if (isYou) {
        mine = cur;
        myShip = ship;
      }
    }

    feedWakes(snapshot);

    for (const [id, ship] of renderedShips) {
      if (seenIds.has(id)) continue;
      scene.remove(ship.group);
      // A ship's hull and rig geometry is built per instance, so dropping the
      // reference alone leaks GPU buffers every time one sails out of range.
      ship.dispose();
      renderedShips.delete(id);
      renderedShipClass.delete(id);
      const ward = renderedProtectRings.get(id);
      if (ward) {
        scene.remove(ward.group);
        renderedProtectRings.delete(id);
      }
    }

    if (mine) {
      minimap.render(
        mine.x,
        mine.z,
        mine.heading,
        world.islands.map((isl) => ({ x: isl.position.x, z: isl.position.z, radius: isl.radius, isHomePort: isl.isHomePort })),
        snapshot,
        network.yourId,
        network.state?.crates ?? [],
        network.state?.salvage ?? [],
        network.state?.outposts ?? [],
      );
    }
  }

  if (mine && myShip) {
    ocean.followTarget(mine.x, mine.z);
    hud.setHealth(mine.health, mine.maxHealth);
    // Driven by the server's authoritative dock test rather than the
    // client's own radius: World.isNearHomePort defaults to radius+15 (37
    // units) while the sanctuary is radius+45 (67), so a player could be
    // safe and auto-banking with no way to open the shipyard. `canDock` is
    // the server's single definition of "you can shop here" and now covers
    // outposts you own as well as home port.
    portBtn.classList.toggle('hidden', !network.state?.you.canDock);

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
