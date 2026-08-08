/** All sound effects are synthesized on the fly via Web Audio (filtered noise
 * bursts + oscillators) so the game ships with zero binary audio assets. */
export class SoundManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private ambientStarted = false;
  private burning = false;
  private burnBed: { src: AudioBufferSourceNode; gain: GainNode; lfo: OscillatorNode } | null = null;
  private burnCrackleHandle: number | null = null;

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

  /** Continuous cue for the local player's own ship while a fire-shot hit
   * has it ablaze: a breathing hiss/roar bed plus randomly-timed crackle
   * pops, so the several-seconds-long ticking burn damage stays audible as
   * an ongoing threat instead of the game going quiet right after the
   * initial hit. Deliberately only ever wired up for the local ship (see
   * main.ts) rather than every burning ship in a fight — that keeps this
   * to at most one extra looping voice no matter how chaotic combat gets. */
  setBurning(burning: boolean) {
    if (!this.ctx || burning === this.burning) return;
    this.burning = burning;
    if (burning) this.startBurning();
    else this.stopBurning();
  }

  private startBurning() {
    const ctx = this.ctx!;
    const src = this.noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2600;
    filter.Q.value = 0.9;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 0.4);
    src.connect(filter).connect(gain).connect(this.masterGain!);
    src.start();

    // Slow-ish LFO on the bandpass cutoff so the roar "breathes" like a
    // real flame instead of sitting on one static hiss.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 4;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 500;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();

    this.burnBed = { src, gain, lfo };
    this.scheduleCrackle();
  }

  /** Schedules one short high-passed noise "pop" and re-arms itself at a
   * random short delay — a lightweight stand-in for a Poisson-ish crackle
   * pattern. Self-terminating (`stop()` scheduled up front) and re-checks
   * `this.burning` before each re-arm, so stopping burning drains this to
   * zero extra nodes/timers rather than leaking a runaway timer chain. */
  private scheduleCrackle() {
    if (!this.burning || !this.ctx) return;
    const ctx = this.ctx;
    const src = this.noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1800 + Math.random() * 1500;
    const gain = ctx.createGain();
    src.connect(filter).connect(gain).connect(this.masterGain!);
    this.envelope(gain, 0.001, 0.05 + Math.random() * 0.04, 0.22 + Math.random() * 0.15);
    src.start();
    src.stop(ctx.currentTime + 0.15);

    this.burnCrackleHandle = window.setTimeout(() => this.scheduleCrackle(), 90 + Math.random() * 180);
  }

  private stopBurning() {
    if (this.burnCrackleHandle !== null) {
      clearTimeout(this.burnCrackleHandle);
      this.burnCrackleHandle = null;
    }
    if (this.burnBed && this.ctx) {
      const { src, gain, lfo } = this.burnBed;
      const now = this.ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0.0001, now + 0.25);
      src.stop(now + 0.3);
      lfo.stop(now + 0.3);
      this.burnBed = null;
    }
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
