import { AMMO_TYPE_ORDER, type AmmoType } from '../shared/protocol';

const COACH_SEEN_KEY = 'rogueTides.seenAmmoCoach';
const COACH_DURATION_MS = 11000;

/**
 * The one-line trade for each shot, in the player's terms rather than the
 * server's. These are derived directly from the tuning constants in
 * server/src/GameRoom.ts and must be kept honest against them:
 *
 *   chain  CHAIN_DAMAGE_MULT 0.5, CHAIN_RELOAD_MULT 1.3,
 *          CHAIN_SPEED_MULT 0.35 for CHAIN_DISABLE_DURATION 3.5s
 *   grape  GRAPE_CLOSE_DAMAGE_MULT 1.6 / GRAPE_FAR_DAMAGE_MULT 0.6
 *   fire   FIRE_INITIAL_DAMAGE_MULT 0.4 then FIRE_DOT_TOTAL_MULT 0.7
 *          spread over FIRE_DURATION 4s
 *
 * They live here, on screen, permanently — not in a `title=` attribute.
 * A tooltip is unreachable on touch, and touch is the priority platform, so
 * for the phone player those descriptions may as well not have existed.
 */
const AMMO_DETAIL: Record<AmmoType, string> = {
  round: 'Full damage, normal reload — the dependable broadside.',
  chain: 'Half damage, slow reload — but cuts their top speed by 65% for 3.5s.',
  grape: '+60% damage point-blank, −40% at range — get alongside.',
  fire: 'Only 40% on impact, then burns for 70% more over 4s.',
};

/**
 * Presentation for the bottom ammo rack: which cell is lit, what the detail
 * strip says, and the one-time coach mark. Selection itself still lives in
 * InputManager (which also owns the 1-4 keybinds); this class only reflects
 * it and reports taps back up.
 */
export class AmmoRack {
  private detailText = document.getElementById('ammo-detail-text') as HTMLSpanElement | null;
  private selector = document.getElementById('ammo-selector') as HTMLDivElement | null;
  private coach = document.getElementById('ammo-coach') as HTMLDivElement | null;
  private buttons = new Map<AmmoType, HTMLButtonElement>();
  private coachTimeout: number | undefined;
  private swapTimeout: number | undefined;

  /** Fired when the player picks a shot from the rack. */
  onSelect: ((ammoType: AmmoType) => void) | null = null;

  constructor() {
    for (const ammoType of AMMO_TYPE_ORDER) {
      const btn = document.querySelector(`.ammo-btn[data-ammo="${ammoType}"]`) as HTMLButtonElement | null;
      if (!btn) continue;
      this.buttons.set(ammoType, btn);
      btn.addEventListener('click', () => {
        this.dismissCoach();
        this.onSelect?.(ammoType);
      });
    }
    this.coach?.addEventListener('click', () => this.dismissCoach());
  }

  /** Light the chosen cell and swap the detail strip to match it. */
  setActive(ammoType: AmmoType) {
    for (const [type, btn] of this.buttons) {
      const on = type === ammoType;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    }
    this.setDetail(AMMO_DETAIL[ammoType]);
  }

  /** Cross-fades rather than snapping, so a switch mid-combat registers as a
   * change in peripheral vision instead of silently rewriting itself. */
  private setDetail(text: string) {
    if (!this.detailText) return;
    if (this.detailText.textContent === text) return;
    const el = this.detailText;
    el.classList.add('swap');
    window.clearTimeout(this.swapTimeout);
    this.swapTimeout = window.setTimeout(() => {
      el.textContent = text;
      el.classList.remove('swap');
    }, 130);
  }

  /** Once per device: a short prompt above the controls plus a glow on the
   * rack itself, so the first-time player looks at it at least once. */
  showCoachIfFirstVisit() {
    if (!this.coach || localStorage.getItem(COACH_SEEN_KEY)) return;
    if (!this.coach.classList.contains('hidden')) return;
    this.coach.classList.remove('hidden');
    this.selector?.classList.add('coach-target');
    window.clearTimeout(this.coachTimeout);
    this.coachTimeout = window.setTimeout(() => this.dismissCoach(), COACH_DURATION_MS);
  }

  dismissCoach() {
    if (!this.coach || this.coach.classList.contains('hidden')) return;
    this.coach.classList.add('hidden');
    this.selector?.classList.remove('coach-target');
    window.clearTimeout(this.coachTimeout);
    localStorage.setItem(COACH_SEEN_KEY, '1');
  }
}
