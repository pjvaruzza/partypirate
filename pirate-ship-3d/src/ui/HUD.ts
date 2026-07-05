import { Economy, MAX_LEVEL, type UpgradeKey, type CannonSide } from '../game/Economy';

const UPGRADE_KEYS: UpgradeKey[] = ['sails', 'cannons', 'hull', 'powder'];
const CANNON_SIDES: CannonSide[] = ['front', 'left', 'right'];

export class HUD {
  private healthFill = document.getElementById('health-fill') as HTMLDivElement;
  private goldAmount = document.getElementById('gold-amount') as HTMLSpanElement;
  private banner = document.getElementById('message-banner') as HTMLDivElement;
  private shipyard = document.getElementById('shipyard') as HTMLDivElement;
  private shipyardClose = document.getElementById('shipyard-close') as HTMLButtonElement;
  private slotsLabel = document.getElementById('cannon-slots-label') as HTMLSpanElement;
  private bannerTimeout: number | undefined;

  onBuy: ((key: UpgradeKey) => void) | null = null;
  onLoadoutChange: (() => void) | null = null;
  onShipyardClose: (() => void) | null = null;

  private economy: Economy;

  constructor(economy: Economy) {
    this.economy = economy;
    for (const key of UPGRADE_KEYS) {
      const row = document.querySelector(`.upgrade-row[data-upgrade="${key}"]`);
      const btn = row?.querySelector('.buy-btn');
      btn?.addEventListener('click', () => this.onBuy?.(key));
    }
    for (const side of CANNON_SIDES) {
      const slot = document.querySelector(`.cannon-slot[data-side="${side}"]`);
      slot?.querySelector('.slot-plus')?.addEventListener('click', () => {
        if (this.economy.incrementSlot(side)) {
          this.refreshShipyard();
          this.onLoadoutChange?.();
        }
      });
      slot?.querySelector('.slot-minus')?.addEventListener('click', () => {
        if (this.economy.decrementSlot(side)) {
          this.refreshShipyard();
          this.onLoadoutChange?.();
        }
      });
    }
    this.shipyardClose.addEventListener('click', () => {
      this.hideShipyard();
      this.onShipyardClose?.();
    });
  }

  setHealth(current: number, max: number) {
    const pct = Math.max(0, Math.min(1, current / max));
    this.healthFill.style.width = `${pct * 100}%`;
  }

  setGold(amount: number) {
    this.goldAmount.textContent = String(Math.floor(amount));
  }

  showMessage(text: string, duration = 2200) {
    this.banner.textContent = text;
    this.banner.classList.add('show');
    window.clearTimeout(this.bannerTimeout);
    this.bannerTimeout = window.setTimeout(() => this.banner.classList.remove('show'), duration);
  }

  showShipyard() {
    this.shipyard.classList.remove('hidden');
    this.refreshShipyard();
  }

  hideShipyard() {
    this.shipyard.classList.add('hidden');
  }

  isShipyardOpen(): boolean {
    return !this.shipyard.classList.contains('hidden');
  }

  refreshShipyard() {
    for (const key of UPGRADE_KEYS) {
      const row = document.querySelector(`.upgrade-row[data-upgrade="${key}"]`);
      if (!row) continue;
      const level = this.economy.state[key];
      const levelEl = row.querySelector('.upgrade-level');
      const costEl = row.querySelector('.cost');
      const btn = row.querySelector('.buy-btn') as HTMLButtonElement;
      if (level >= MAX_LEVEL) {
        if (levelEl) levelEl.textContent = `(MAX)`;
        if (costEl) costEl.textContent = '';
        btn.disabled = true;
        btn.textContent = 'MAXED';
      } else {
        if (levelEl) levelEl.textContent = `(Lv ${level})`;
        const cost = this.economy.costFor(key);
        if (costEl) costEl.textContent = String(cost);
        btn.innerHTML = `Buy <span class="cost">${cost}</span> 🪙`;
        btn.disabled = !this.economy.canAfford(key);
      }
    }

    const unassigned = this.economy.unassignedCannonSlots();
    this.slotsLabel.textContent = `${this.economy.assignedCannonSlots()}/${this.economy.totalCannonSlots()} mounted${
      unassigned > 0 ? ` · ${unassigned} unassigned` : ''
    }`;
    for (const side of CANNON_SIDES) {
      const slot = document.querySelector(`.cannon-slot[data-side="${side}"]`);
      if (!slot) continue;
      const countEl = slot.querySelector('.slot-count') as HTMLSpanElement;
      const plusBtn = slot.querySelector('.slot-plus') as HTMLButtonElement;
      const minusBtn = slot.querySelector('.slot-minus') as HTMLButtonElement;
      countEl.textContent = String(this.economy.state.loadout[side]);
      plusBtn.disabled = !this.economy.canIncrementSlot(side);
      minusBtn.disabled = !this.economy.canDecrementSlot(side);
    }

    this.setGold(this.economy.state.gold);
  }
}
