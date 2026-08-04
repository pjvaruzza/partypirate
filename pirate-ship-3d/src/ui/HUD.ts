import { FRONT_SLOT_MAX, SIDE_SLOT_MAX, type CannonSide, type EconomySnapshot, type ShipClass, type UpgradeKey } from '../shared/protocol';

const UPGRADE_KEYS: UpgradeKey[] = ['sails', 'cannons', 'hull', 'powder'];
const CANNON_SIDES: CannonSide[] = ['front', 'left', 'right'];
const CLASS_NAMES: Record<ShipClass, string> = { sloop: 'Sloop', brigantine: 'Brigantine', galleon: 'Galleon' };

/** Hand-authored "piece of eight" coin, matching the one baked into
 * index.html's #gold-counter — kept as one constant so both places render
 * identically instead of drifting, and so nothing here depends on emoji
 * glyph coverage (which varies wildly across OS/browser font stacks). */
const COIN_ICON =
  '<svg class="icon icon-coin" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<circle cx="12" cy="12" r="10" fill="currentColor"/>' +
  '<circle cx="12" cy="12" r="7" fill="none" stroke="rgba(0,0,0,0.4)" stroke-width="1"/>' +
  '<path d="M12 5.5v13M5.5 12h13M7.6 7.6l8.8 8.8M16.4 7.6l-8.8 8.8" stroke="rgba(0,0,0,0.35)" stroke-width="0.8"/>' +
  '</svg>';

/** Purely a display for whatever EconomySnapshot the server last confirmed —
 * buy/loadout buttons just send requests over the network and wait for the
 * next snapshot to reflect the result, rather than mutating local state. */
export class HUD {
  private healthFill = document.getElementById('health-fill') as HTMLDivElement;
  private heatBar = document.getElementById('heat-bar') as HTMLDivElement;
  private heatFill = document.getElementById('heat-fill') as HTMLDivElement;
  private goldAmount = document.getElementById('gold-amount') as HTMLSpanElement;
  private holdCounter = document.getElementById('hold-counter') as HTMLDivElement | null;
  private holdAmount = document.getElementById('hold-amount') as HTMLSpanElement | null;
  private holdRisk = document.getElementById('hold-risk') as HTMLSpanElement | null;
  private bankedFlashTimeout: number | undefined;
  private banner = document.getElementById('message-banner') as HTMLDivElement;
  private shipyard = document.getElementById('shipyard') as HTMLDivElement;
  private shipyardClose = document.getElementById('shipyard-close') as HTMLButtonElement;
  private portBtn = document.getElementById('port-btn') as HTMLButtonElement | null;
  private slotsLabel = document.getElementById('cannon-slots-label') as HTMLSpanElement;
  private className = document.getElementById('class-name') as HTMLSpanElement;
  private classBuyBtn = document.getElementById('class-buy-btn') as HTMLButtonElement;
  private bannerTimeout: number | undefined;
  private latestEconomy: EconomySnapshot | null = null;

  onBuy: ((key: UpgradeKey) => void) | null = null;
  onSlotChange: ((side: CannonSide, delta: 1 | -1) => void) | null = null;
  onBuyClass: (() => void) | null = null;
  onShipyardClose: (() => void) | null = null;

  constructor() {
    for (const key of UPGRADE_KEYS) {
      const row = document.querySelector(`.upgrade-row[data-upgrade="${key}"]`);
      row?.querySelector('.buy-btn')?.addEventListener('click', () => this.onBuy?.(key));
    }
    for (const side of CANNON_SIDES) {
      const slot = document.querySelector(`.cannon-slot[data-side="${side}"]`);
      slot?.querySelector('.slot-plus')?.addEventListener('click', () => this.onSlotChange?.(side, 1));
      slot?.querySelector('.slot-minus')?.addEventListener('click', () => this.onSlotChange?.(side, -1));
    }
    this.classBuyBtn.addEventListener('click', () => this.onBuyClass?.());
    this.shipyardClose.addEventListener('click', () => {
      this.hideShipyard();
      this.onShipyardClose?.();
    });

    // Keyboard-independent-of-touch safety net: Escape closes the shipyard,
    // mirroring Chat's Escape-to-cancel. On a tall panel that scrolls (small
    // phone viewports) this is the only way to close without hunting for the
    // "Set Sail" button, and it costs nothing on desktop where the panel
    // already fits.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isShipyardOpen()) {
        this.hideShipyard();
        this.onShipyardClose?.();
      }
    });
  }

  setHealth(current: number, max: number) {
    const pct = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
    this.healthFill.style.width = `${pct * 100}%`;
  }

  setGold(amount: number) {
    this.goldAmount.textContent = String(Math.floor(amount));
  }

  /** Unbanked gold and how much of it would actually spill if sunk right
   * now. Hidden entirely when the hold is empty so it isn't permanent HUD
   * furniture — it should appear as a consequence of going out to sea. */
  setHold(hold: number, atRisk: number, inSanctuary: boolean) {
    if (!this.holdCounter || !this.holdAmount || !this.holdRisk) return;
    this.holdCounter.classList.toggle('hidden', hold <= 0);
    this.holdAmount.textContent = String(Math.floor(hold));
    this.holdRisk.textContent = inSanctuary ? 'banking…' : atRisk > 0 ? `−${atRisk} if sunk` : '';
  }

  /** Briefly tints the hold readout on a successful bank. Placeholder for the
   * real "gold slides into the vault" moment — mobile-ux/sound-design. */
  flashBanked() {
    if (!this.holdCounter) return;
    this.holdCounter.classList.remove('hidden');
    this.holdCounter.classList.add('banked');
    window.clearTimeout(this.bankedFlashTimeout);
    this.bankedFlashTimeout = window.setTimeout(() => {
      this.holdCounter?.classList.remove('banked');
      if (Number(this.holdAmount?.textContent ?? '0') <= 0) this.holdCounter?.classList.add('hidden');
    }, 900);
  }

  setHeat(heat: number) {
    this.heatBar.classList.toggle('hidden', heat <= 0);
    this.heatFill.style.width = `${Math.max(0, Math.min(100, heat))}%`;
  }

  showMessage(text: string, duration = 2200) {
    this.banner.textContent = text;
    this.banner.classList.add('show');
    window.clearTimeout(this.bannerTimeout);
    this.bannerTimeout = window.setTimeout(() => this.banner.classList.remove('show'), duration);
  }

  showShipyard() {
    this.shipyard.classList.remove('hidden');
    if (this.latestEconomy) this.renderShipyard(this.latestEconomy);
  }

  hideShipyard() {
    this.shipyard.classList.add('hidden');
    // Defense in depth alongside main.ts's blur-on-open: whichever element
    // still has focus when the shipyard closes (typically #port-btn, but
    // #shipyard-close itself if closed by tap) must not keep it, or a
    // trailing Space press (the fire key) would re-trigger it as a native
    // button activation instead of firing a cannon.
    this.portBtn?.blur();
    if (document.activeElement instanceof HTMLElement && this.shipyard.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  isShipyardOpen(): boolean {
    return !this.shipyard.classList.contains('hidden');
  }

  /** Call whenever a fresh server state arrives. */
  updateEconomy(economy: EconomySnapshot) {
    this.latestEconomy = economy;
    this.setGold(economy.gold);
    this.setHold(economy.hold, economy.holdAtRisk, economy.inSanctuary);
    this.setHeat(economy.heat);
    if (this.isShipyardOpen()) this.renderShipyard(economy);
  }

  private renderShipyard(economy: EconomySnapshot) {
    this.className.textContent = `(${CLASS_NAMES[economy.shipClass]})`;
    if (!economy.nextClass || economy.nextClassCost === null) {
      this.classBuyBtn.disabled = true;
      this.classBuyBtn.textContent = 'MAXED';
    } else {
      this.classBuyBtn.innerHTML = `Buy ${CLASS_NAMES[economy.nextClass]} <span class="cost">${economy.nextClassCost}</span> ${COIN_ICON}`;
      this.classBuyBtn.disabled = economy.gold < economy.nextClassCost;
    }

    for (const key of UPGRADE_KEYS) {
      const row = document.querySelector(`.upgrade-row[data-upgrade="${key}"]`);
      if (!row) continue;
      const levelEl = row.querySelector('.upgrade-level');
      const costEl = row.querySelector('.cost');
      const btn = row.querySelector('.buy-btn') as HTMLButtonElement;
      if (economy.maxed[key]) {
        if (levelEl) levelEl.textContent = '(MAX)';
        if (costEl) costEl.textContent = '';
        btn.disabled = true;
        btn.textContent = 'MAXED';
      } else {
        if (levelEl) levelEl.textContent = `(Lv ${economy[key]})`;
        const cost = economy.costs[key];
        if (costEl) costEl.textContent = String(cost);
        btn.innerHTML = `Buy <span class="cost">${cost}</span> ${COIN_ICON}`;
        btn.disabled = economy.gold < cost;
      }
    }

    const unassigned = economy.totalCannonSlots - economy.assignedCannonSlots;
    this.slotsLabel.textContent = `${economy.assignedCannonSlots}/${economy.totalCannonSlots} mounted${
      unassigned > 0 ? ` · ${unassigned} unassigned` : ''
    }`;
    for (const side of CANNON_SIDES) {
      const slot = document.querySelector(`.cannon-slot[data-side="${side}"]`);
      if (!slot) continue;
      const countEl = slot.querySelector('.slot-count') as HTMLSpanElement;
      const plusBtn = slot.querySelector('.slot-plus') as HTMLButtonElement;
      const minusBtn = slot.querySelector('.slot-minus') as HTMLButtonElement;
      const sideMax = side === 'front' ? FRONT_SLOT_MAX : SIDE_SLOT_MAX;
      countEl.textContent = String(economy.loadout[side]);
      plusBtn.disabled = unassigned <= 0 || economy.loadout[side] >= sideMax;
      minusBtn.disabled = economy.loadout[side] <= 0;
    }
  }
}
