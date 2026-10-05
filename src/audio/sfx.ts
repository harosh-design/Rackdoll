/** Generated one-shots; procedural cues remain available while files load. */
const samples = [
  'bump', 'clack', 'thud', 'perfect', 'counter', 'rescue',
  'miss', 'point', 'lose', 'executer', 'button', 'rearm',
  'gift', 'bee', 'slime',
] as const;
type Sample = typeof samples[number];

export class Sfx {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<Sample, AudioBuffer>();
  private loading: Promise<void> | null = null;

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
    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 18;
    compressor.ratio.value = 2.5;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.16;
    this.master.connect(compressor).connect(this.ctx.destination);
    this.load();
  }

  private load(): void {
    if (!this.ctx || this.loading) return;
    const ctx = this.ctx;
    this.loading = Promise.all(samples.map(async (name) => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}audio/${name}.ogg`);
        if (!response.ok) return;
        this.buffers.set(name, await ctx.decodeAudioData(await response.arrayBuffer()));
      } catch {
        // Keep the procedural cue if a file cannot be loaded or decoded.
      }
    })).then(() => undefined);
  }

  private play(name: Sample, volume = 1, rate = 1): boolean {
    if (!this.enabled || !this.ctx || !this.master) return false;
    const buffer = this.buffers.get(name);
    if (!buffer) return false;
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.value = volume;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = name === 'bump' || name === 'thud' || name === 'bee' || name === 'slime' ? 6500 : 9500;
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
    return true;
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
    if (this.play('bump', 0.42 + s * 0.32, 0.94 + s * 0.12)) return;
    this.tone(260 + s * 180, 0.09, 'triangle', 0.25 + s * 0.45, 140);
  }

  /** Ball off a wall or the net. */
  clack(strength: number): void {
    const s = Math.min(1, strength / 1.5);
    if (this.play('clack', 0.38 + s * 0.28, 0.94 + s * 0.12)) return;
    this.tone(520 + s * 200, 0.05, 'square', 0.08 + s * 0.12, 300);
  }

  /** Ball into the sand. */
  thud(quiet = false): void {
    if (this.play('thud', quiet ? 0.38 : 0.67)) return;
    this.noise(0.16, quiet ? 0.28 : 0.5, 700);
    this.tone(120, 0.14, 'sine', quiet ? 0.26 : 0.45, 60);
  }

  perfect(): void {
    if (this.play('perfect', 0.73)) return;
    this.tone(720, 0.13, 'sine', 0.4, 1120);
    this.tone(1440, 0.08, 'triangle', 0.16);
  }

  counter(): void {
    if (this.play('counter', 0.72)) return;
    this.noise(0.09, 0.45, 1600);
    this.tone(180, 0.2, 'square', 0.35, 520);
  }

  rescue(success: boolean): void {
    if (this.play(success ? 'rescue' : 'miss', 0.65)) return;
    this.tone(success ? 540 : 240, 0.12, 'triangle', 0.32, success ? 900 : 160);
  }

  point(): void {
    if (this.play('point', 0.75)) return;
    this.tone(660, 0.12, 'sine', 0.3);
    setTimeout(() => this.tone(880, 0.18, 'sine', 0.3), 110);
  }

  lose(): void {
    if (this.play('lose', 0.72)) return;
    this.tone(330, 0.2, 'sine', 0.3, 220);
  }

  executer(): void {
    if (this.play('executer', 0.55)) return;
    this.tone(90, 0.5, 'sawtooth', 0.25, 45);
  }

  /** The slime: a wet squelch as it sticks or glues, higher and thinner as a strand tears. */
  splat(tear = false): void {
    if (this.play('slime', tear ? 0.38 : 0.55, tear ? 1.55 : 1)) return;
    this.noise(tear ? 0.06 : 0.12, tear ? 0.3 : 0.45, tear ? 2400 : 900);
    this.tone(tear ? 520 : 240, tear ? 0.08 : 0.14, 'sine', 0.25, tear ? 900 : 90);
  }

  /** A button pressed into the wall: a hard mechanical clunk. */
  button(): void {
    if (this.play('button', 0.6)) return;
    this.noise(0.05, 0.6, 2600);
    this.tone(180, 0.09, 'square', 0.22, 70);
  }

  /** The button pops back out, armed. */
  buttonRearm(): void {
    if (this.play('rearm', 0.62)) return;
    this.tone(520, 0.08, 'triangle', 0.22, 900);
  }

  /** A bee flies in: a short, soft buzz, deeper for a bigger bee. */
  beeBuzz(size = 1): void {
    if (this.play('bee', 0.38, 1 / Math.max(0.8, size))) return;
    if (!this.enabled || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(230 / size, t);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 26;
    const depth = ctx.createGain();
    depth.gain.value = 14 / size;
    lfo.connect(depth).connect(osc.frequency);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 900;
    band.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.15);
    g.gain.setValueAtTime(0.07, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    osc.connect(band).connect(g).connect(this.master);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 0.85);
    lfo.stop(t + 0.85);
  }

  /** A gift collected: the ability starts. */
  giftPickup(): void {
    if (this.play('gift', 0.64)) return;
    this.tone(660, 0.1, 'triangle', 0.3, 990);
    setTimeout(() => this.tone(1320, 0.16, 'sine', 0.25), 90);
  }
}
