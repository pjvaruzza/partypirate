import type { InputState } from '../shared/protocol';

export type { InputState };

export class InputManager {
  readonly state: InputState = { turn: 0, throttle: 0, fire: false, boost: false };

  private keys = new Set<string>();
  private joystickActive = false;
  private joystickPointerId: number | null = null;
  private joystickOrigin = { x: 0, y: 0 };
  private touchFire = false;
  private touchBoost = false;

  constructor() {
    window.addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));

    this.setupJoystick();
    this.setupButton('fire-btn', 'fire');
    this.setupButton('boost-btn', 'boost');
  }

  private setupButton(id: string, field: 'fire' | 'boost') {
    const el = document.getElementById(id);
    if (!el) return;
    const target = field === 'fire' ? 'touchFire' : 'touchBoost';
    const on = (e: Event) => {
      e.preventDefault();
      this[target] = true;
    };
    const off = (e: Event) => {
      e.preventDefault();
      this[target] = false;
    };
    el.addEventListener('touchstart', on, { passive: false });
    el.addEventListener('touchend', off, { passive: false });
    el.addEventListener('mousedown', on);
    el.addEventListener('mouseup', off);
  }

  private setupJoystick() {
    const zone = document.getElementById('joystick-zone');
    const knob = document.getElementById('joystick-knob');
    if (!zone || !knob) return;

    const maxDist = 40;

    const start = (id: number, x: number, y: number) => {
      this.joystickActive = true;
      this.joystickPointerId = id;
      const rect = zone.getBoundingClientRect();
      this.joystickOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      move(x, y);
    };

    const move = (x: number, y: number) => {
      if (!this.joystickActive) return;
      let dx = x - this.joystickOrigin.x;
      let dy = y - this.joystickOrigin.y;
      const dist = Math.min(Math.hypot(dx, dy), maxDist);
      const angle = Math.atan2(dy, dx);
      const cx = Math.cos(angle) * dist;
      const cy = Math.sin(angle) * dist;
      knob.style.transform = `translate(calc(-50% + ${cx}px), calc(-50% + ${cy}px))`;
      this.state.turn = Math.max(-1, Math.min(1, cx / maxDist));
      this.state.throttle = Math.max(-1, Math.min(1, -cy / maxDist));
    };

    const end = () => {
      this.joystickActive = false;
      this.joystickPointerId = null;
      knob.style.transform = `translate(-50%, -50%)`;
      this.state.turn = 0;
      this.state.throttle = 0;
    };

    zone.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        start(t.identifier, t.clientX, t.clientY);
      },
      { passive: false },
    );
    window.addEventListener(
      'touchmove',
      (e) => {
        for (const t of Array.from(e.changedTouches)) {
          if (t.identifier === this.joystickPointerId) move(t.clientX, t.clientY);
        }
      },
      { passive: false },
    );
    window.addEventListener('touchend', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.joystickPointerId) end();
      }
    });

    zone.addEventListener('mousedown', (e) => {
      start(-1, e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
    window.addEventListener('mouseup', () => {
      if (this.joystickPointerId === -1) end();
    });
  }

  update() {
    if (!this.joystickActive) {
      let turn = 0;
      let throttle = 0;
      if (this.keys.has('a') || this.keys.has('arrowleft')) turn -= 1;
      if (this.keys.has('d') || this.keys.has('arrowright')) turn += 1;
      if (this.keys.has('w') || this.keys.has('arrowup')) throttle += 1;
      if (this.keys.has('s') || this.keys.has('arrowdown')) throttle -= 1;
      this.state.turn = turn;
      this.state.throttle = throttle;
    }
    this.state.fire = this.touchFire || this.keys.has(' ');
    this.state.boost = this.touchBoost || this.keys.has('shift');
  }
}
