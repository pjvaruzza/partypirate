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

  constructor() {
    this.closeBtn.addEventListener('click', () => this.close());
    this.helpBtn.addEventListener('click', () => this.open());
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
  }

  close() {
    this.overlay.classList.add('hidden');
    localStorage.setItem(SEEN_KEY, '1');
  }
}
