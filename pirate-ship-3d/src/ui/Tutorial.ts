const SEEN_KEY = 'rogueTides.seenTutorial';

/** A one-time "how to play" overlay shown the first time this browser joins
 * — tracked in localStorage, which is fine here since it's a UI preference
 * (has this device seen the tips?), not game progress (that's all
 * server-side, keyed by captain name; see server/src/persistence.ts).
 * Reopenable anytime via the help button. */
export class Tutorial {
  private overlay = document.getElementById('tutorial') as HTMLDivElement;
  private closeBtn = document.getElementById('tutorial-close') as HTMLButtonElement;
  private helpBtn = document.getElementById('help-btn') as HTMLButtonElement;
  private scroll = document.getElementById('tutorial-scroll') as HTMLDivElement | null;

  /** Fired whenever the overlay is dismissed, so follow-on onboarding (the
   * ammo coach mark) can queue behind it instead of overlapping it. */
  onClose: (() => void) | null = null;

  constructor() {
    this.closeBtn.addEventListener('click', () => this.close());
    this.helpBtn.addEventListener('click', () => this.open());
    this.scroll?.addEventListener('scroll', () => this.updateScrollCue(), { passive: true });
    window.addEventListener('resize', () => this.updateScrollCue());
  }

  /** Marks the scroll area while content remains below the fold, so the
   * fade cue in style.css appears only when there is genuinely more to see.
   * On a 375x667 phone the ammo section sits entirely past the fold. */
  private updateScrollCue() {
    if (!this.scroll) return;
    const remaining = this.scroll.scrollHeight - this.scroll.clientHeight - this.scroll.scrollTop;
    this.scroll.classList.toggle('more-below', remaining > 8);
  }

  showIfFirstVisit() {
    if (localStorage.getItem(SEEN_KEY)) return;
    this.open();
  }

  isOpen(): boolean {
    return !this.overlay.classList.contains('hidden');
  }

  open() {
    this.overlay.classList.remove('hidden');
    // Reopening via the help button must not resume someone else's scroll
    // position — the ammo section is near the top and should be what a
    // returning player lands on.
    if (this.scroll) this.scroll.scrollTop = 0;
    this.updateScrollCue();
  }

  close() {
    this.overlay.classList.add('hidden');
    localStorage.setItem(SEEN_KEY, '1');
    this.onClose?.();
  }
}
