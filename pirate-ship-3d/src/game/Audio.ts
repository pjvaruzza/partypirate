/** All sound effects are synthesized on the fly via Web Audio (filtered noise
 * bursts + oscillators) so the game ships with zero binary audio assets. */
export class SoundManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private ambientStarted = false;

  /** Must be called from a user-gesture handler — browsers block audio until then. */
  resume() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.6;
      this.masterGain.connect(this.ctx.destination);
      this.noiseBuffer = this.createNoiseBuffer(this.ctx);
    }
    void this.ctx.resume();
    this.startAmbient();
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private noiseSource(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    return src;
  }

  private envelope(gain: GainNode, attack: number, decay: number, peak: number) {
    const now = this.ctx!.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
  }

  cannonFire() {
    if (!this.ctx) return;
    const src = this.noiseSource();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const gain = this.ctx.createGain();
    src.connect(filter).connect(gain).connect(this.masterGain!);
    this.envelope(gain, 0.005, 0.25, 0.9);
    src.start();
    src.stop(this.ctx.currentTime + 0.35);
  }

  splash() {
    if (!this.ctx) return;
    const src = this.noiseSource();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800;
    filter.Q.value = 0.6;
    const gain = this.ctx.createGain();
    src.connect(filter).connect(gain).connect(this.masterGain!);
    this.envelope(gain, 0.005, 0.18, 0.35);
    src.start();
    src.stop(this.ctx.currentTime + 0.25);
  }

  hitImpact() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Crack layer — the wood-splinter transient.
    const src = this.noiseSource();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    const gain = this.ctx.createGain();
    src.connect(filter).connect(gain).connect(this.masterGain!);
    this.envelope(gain, 0.002, 0.12, 0.8);
    src.start();
    src.stop(now + 0.2);

    // Thud layer — a fast-dropping low sine underneath for weight/punch.
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.16);
    const thudGain = this.ctx.createGain();
    osc.connect(thudGain).connect(this.masterGain!);
    this.envelope(thudGain, 0.002, 0.18, 0.7);
    osc.start();
    osc.stop(now + 0.22);
  }

  ramImpact() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Wide-band wood crack — beefier and longer than hitImpact's.
    const src = this.noiseSource();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 350;
    filter.Q.value = 0.5;
    const gain = this.ctx.createGain();
    src.connect(filter).connect(gain).connect(this.masterGain!);
    this.envelope(gain, 0.003, 0.22, 1.0);
    src.start();
    src.stop(now + 0.3);

    // Deep, slower-decaying thud for real hull-on-hull weight.
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(100, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.3);
    const thudGain = this.ctx.createGain();
    osc.connect(thudGain).connect(this.masterGain!);
    this.envelope(thudGain, 0.003, 0.32, 0.9);
    osc.start();
    osc.stop(now + 0.38);
  }

  sink() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 1.4);
    const gain = this.ctx.createGain();
    osc.connect(gain).connect(this.masterGain!);
    this.envelope(gain, 0.02, 1.3, 0.5);
    osc.start();
    osc.stop(this.ctx.currentTime + 1.5);
  }

  private startAmbient() {
    if (this.ambientStarted || !this.ctx) return;
    this.ambientStarted = true;

    const src = this.noiseSource();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.06;
    src.connect(filter).connect(gain).connect(this.masterGain!);
    src.start();

    // Slow LFO on the filter cutoff to give the ambient loop a "gusting wind" feel.
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
  }

  setMuted(muted: boolean) {
    if (this.masterGain) this.masterGain.gain.value = muted ? 0 : 0.6;
  }
}
