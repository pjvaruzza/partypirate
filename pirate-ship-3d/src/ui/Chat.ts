const MAX_LOG_LINES = 8;
const FADE_AFTER_MS = 8000;

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/** Simple text chat: Enter opens the input (from anywhere in the game),
 * Enter again sends, Escape cancels. Messages come from other players over
 * the network, so they're rendered via textContent/escaped HTML — never
 * trusted as markup. */
export class Chat {
  private log = document.getElementById('chat-log') as HTMLDivElement;
  private inputWrap = document.getElementById('chat-input-wrap') as HTMLDivElement;
  private input = document.getElementById('chat-input') as HTMLInputElement;

  onSend: ((text: string) => void) | null = null;

  constructor() {
    this.input.addEventListener('keydown', (e) => {
      // Stop these from also reaching the InputManager's window-level listener.
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.input.value.trim();
        if (text) this.onSend?.(text);
        this.close();
      } else if (e.key === 'Escape') {
        this.close();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !this.isOpen()) {
        e.preventDefault();
        this.open();
      }
    });
  }

  isOpen(): boolean {
    return !this.inputWrap.classList.contains('hidden');
  }

  open() {
    this.inputWrap.classList.remove('hidden');
    this.input.value = '';
    this.input.focus();
  }

  close() {
    this.inputWrap.classList.add('hidden');
    this.input.blur();
  }

  addMessage(name: string, text: string) {
    const line = document.createElement('div');
    line.className = 'chat-line';
    line.innerHTML = `<span class="chat-name">${escapeHtml(name)}:</span> ${escapeHtml(text)}`;
    this.log.appendChild(line);
    while (this.log.children.length > MAX_LOG_LINES) {
      this.log.removeChild(this.log.firstChild as ChildNode);
    }
    window.setTimeout(() => line.classList.add('fade'), FADE_AFTER_MS);
  }
}
