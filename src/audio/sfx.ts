/**
 * Tiny procedural sound. The original shipped samples; the spec does not
 * describe them, so these are stand-ins. Nothing here touches the simulation.
 */
export class Sfx {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  /** Browsers only allow audio after a user gesture; call from one. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.32;
    this.master.connect(this.ctx.destination);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, lowpass: number): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lowpass;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  /** Ball off a doll. Strength ~ normal impulse. */
  bump(strength: number): void {
    const s = Math.min(1, strength / 1.5);
    this.tone(260 + s * 180, 0.09, 'triangle', 0.25 + s * 0.45, 140);
  }

  /** Ball off a wall or the net. */
  clack(strength: number): void {
    const s = Math.min(1, strength / 1.5);
    this.tone(520 + s * 200, 0.05, 'square', 0.08 + s * 0.12, 300);
  }

  /** Ball into the sand. */
  thud(): void {
    this.noise(0.16, 0.5, 700);
    this.tone(120, 0.14, 'sine', 0.45, 60);
  }

  serve(): void {
    this.tone(300, 0.12, 'triangle', 0.4, 620);
  }

  perfect(): void {
    this.tone(720, 0.13, 'sine', 0.4, 1120);
    this.tone(1440, 0.08, 'triangle', 0.16);
  }

  counter(): void {
    this.noise(0.09, 0.45, 1600);
    this.tone(180, 0.2, 'square', 0.35, 520);
  }

  rescue(success: boolean): void {
    this.tone(success ? 540 : 240, 0.12, 'triangle', 0.32, success ? 900 : 160);
  }

  point(): void {
    this.tone(660, 0.12, 'sine', 0.3);
    setTimeout(() => this.tone(880, 0.18, 'sine', 0.3), 110);
  }

  lose(): void {
    this.tone(330, 0.2, 'sine', 0.3, 220);
  }

  executer(): void {
    this.tone(90, 0.5, 'sawtooth', 0.25, 45);
  }

  /** A button pressed into the wall: a hard mechanical clunk. */
  button(): void {
    this.noise(0.05, 0.6, 2600);
    this.tone(180, 0.09, 'square', 0.22, 70);
  }

  /** The button pops back out, armed. */
  buttonRearm(): void {
    this.tone(520, 0.08, 'triangle', 0.22, 900);
  }
}
