import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { GameRoom } from './GameRoom';
import { flushSync, loadPlayer } from './persistence';
import type { ClientMessage, ServerMessage, ShipSnapshot, CannonballSnapshot, CrateInfo } from '../../src/shared/protocol';

const PORT = Number(process.env.PORT ?? 8787);
const TICK_MS = 50;
const MAX_NAME_LENGTH = 20;

const room = new GameRoom();
const wss = new WebSocketServer({ port: PORT });

console.log(`Pirate ship server listening on ws://0.0.0.0:${PORT}`);

function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

wss.on('connection', (socket: WebSocket) => {
  let shipId: string | null = null;

  socket.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'join') {
      if (shipId) return;
      const name = String(msg.name || 'Captain').trim().slice(0, MAX_NAME_LENGTH) || 'Captain';
      const economy = loadPlayer(name);
      const id = randomUUID();
      shipId = id;
      room.addPlayer(id, name, socket, economy);
      send(socket, { type: 'welcome', yourId: id, worldRadius: room.worldRadius, islands: room.islands });
      return;
    }

    if (!shipId) return;
    const ship = room.ships.get(shipId);
    if (!ship || ship.isBot) return;

    if (msg.type === 'input') {
      ship.input = msg.input;
    } else if (msg.type === 'buy') {
      room.buyUpgrade(ship, msg.key);
    } else if (msg.type === 'loadout') {
      room.setLoadoutSlot(ship, msg.side, msg.delta);
    }
  });

  socket.on('close', () => {
    if (shipId) room.removePlayer(shipId);
  });
});

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  room.tick(dt);
  broadcast();
}, TICK_MS);

function broadcast() {
  const shipsSnapshot: ShipSnapshot[] = [...room.ships.values()].map((s) => ({
    id: s.id,
    name: s.name,
    isBot: s.isBot,
    x: s.body.x,
    z: s.body.z,
    heading: s.body.heading,
    speed: s.body.speed,
    health: s.health,
    maxHealth: s.maxHealth,
    loadout: s.loadout,
    alive: s.alive,
  }));
  const cannonballsSnapshot: CannonballSnapshot[] = room.cannonballs.map((b) => ({ id: b.id, x: b.x, y: b.y, z: b.z }));
  const cratesSnapshot: CrateInfo[] = room.crates
    .filter((c) => !c.collected)
    .map((c) => ({ id: c.id, x: c.x, z: c.z, value: c.value }));

  for (const ship of room.ships.values()) {
    if (ship.isBot) continue;
    const you = room.buildEconomySnapshot(ship);
    send(ship.socket, { type: 'state', ships: shipsSnapshot, cannonballs: cannonballsSnapshot, crates: cratesSnapshot, you });

    const personalEvents = room.events.filter((e) => !('for' in e) || e.for === undefined || e.for === ship.id);
    if (personalEvents.length > 0) send(ship.socket, { type: 'events', events: personalEvents });
  }
}

function shutdown() {
  flushSync();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
