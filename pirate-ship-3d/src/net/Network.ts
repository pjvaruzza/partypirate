import type {
  CannonSide,
  ClientMessage,
  GameEvent,
  InputState,
  ServerMessage,
  ShipSnapshot,
  CannonballSnapshot,
  StateMessage,
  UpgradeKey,
  WelcomeMessage,
} from '../shared/protocol';

const TICK_INTERVAL_MS = 50;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

/** Thin WebSocket client: sends input, receives authoritative snapshots and
 * discrete events, and smooths ship/cannonball motion between the server's
 * ~20Hz ticks so 60fps rendering doesn't look stepped. */
export class Network {
  yourId = '';

  onWelcome: ((msg: WelcomeMessage) => void) | null = null;
  onEvents: ((events: GameEvent[]) => void) | null = null;
  onState: ((msg: StateMessage) => void) | null = null;
  onDisconnect: (() => void) | null = null;

  private ws: WebSocket | null = null;
  private latestState: StateMessage | null = null;
  private prevState: StateMessage | null = null;
  private lastStateTime = 0;

  connect(url: string, name: string) {
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.addEventListener('open', () => this.send({ type: 'join', name }));
    ws.addEventListener('message', (ev) => this.handleMessage(ev.data as string));
    ws.addEventListener('close', () => this.onDisconnect?.());
  }

  private handleMessage(data: string) {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    if (msg.type === 'welcome') {
      this.yourId = msg.yourId;
      this.onWelcome?.(msg);
    } else if (msg.type === 'state') {
      this.prevState = this.latestState;
      this.latestState = msg;
      this.lastStateTime = performance.now();
      this.onState?.(msg);
    } else if (msg.type === 'events') {
      this.onEvents?.(msg.events);
    }
  }

  private send(msg: ClientMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendInput(input: InputState) {
    this.send({ type: 'input', input });
  }

  buyUpgrade(key: UpgradeKey) {
    this.send({ type: 'buy', key });
  }

  buyShipClass() {
    this.send({ type: 'buyClass' });
  }

  changeLoadout(side: CannonSide, delta: 1 | -1) {
    this.send({ type: 'loadout', side, delta });
  }

  sendChat(text: string) {
    this.send({ type: 'chat', text });
  }

  /** The latest confirmed state, undelayed — used for HUD/economy display. */
  get state(): StateMessage | null {
    return this.latestState;
  }

  /** Ship positions interpolated between the last two ticks for smooth rendering. */
  getRenderShips(): ShipSnapshot[] {
    if (!this.latestState) return [];
    if (!this.prevState) return this.latestState.ships;
    const t = Math.min(1, (performance.now() - this.lastStateTime) / TICK_INTERVAL_MS);
    const prevById = new Map(this.prevState.ships.map((s) => [s.id, s]));
    return this.latestState.ships.map((cur) => {
      const prev = prevById.get(cur.id);
      if (!prev) return cur;
      return { ...cur, x: lerp(prev.x, cur.x, t), z: lerp(prev.z, cur.z, t), heading: lerpAngle(prev.heading, cur.heading, t) };
    });
  }

  /** Cannonball positions interpolated the same way — they move fast enough
   * that snapping between ticks would be visibly choppy otherwise. */
  getRenderCannonballs(): CannonballSnapshot[] {
    if (!this.latestState) return [];
    if (!this.prevState) return this.latestState.cannonballs;
    const t = Math.min(1, (performance.now() - this.lastStateTime) / TICK_INTERVAL_MS);
    const prevById = new Map(this.prevState.cannonballs.map((b) => [b.id, b]));
    return this.latestState.cannonballs.map((cur) => {
      const prev = prevById.get(cur.id);
      if (!prev) return cur;
      return { ...cur, x: lerp(prev.x, cur.x, t), y: lerp(prev.y, cur.y, t), z: lerp(prev.z, cur.z, t) };
    });
  }
}
