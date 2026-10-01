/** Generated one-shots; procedural cues remain available while files load. */
const samples = [
  'bump', 'clack', 'thud', 'serve', 'perfect', 'counter', 'rescue',
  'miss', 'point', 'lose', 'executer', 'button', 'rearm',
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
    this.master.connect(this.ctx.destination);
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
    source.connect(gain).connect(this.master);
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
  thud(): void {
    if (this.play('thud', 0.67)) return;
    this.noise(0.16, 0.5, 700);
    this.tone(120, 0.14, 'sine', 0.45, 60);
  }

  serve(): void {
    if (this.play('serve', 0.67)) return;
    this.tone(300, 0.12, 'triangle', 0.4, 620);
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

  /** A gift drops onto the court. */
  giftSpawn(): void {
    if (this.play('rearm', 0.55, 1.35)) return;
    this.tone(880, 0.1, 'sine', 0.22, 1320);
  }

  /** A gift collected: the ability starts. */
  giftPickup(): void {
    if (this.play('rescue', 0.7, 1.1)) return;
    this.tone(660, 0.1, 'triangle', 0.3, 990);
    setTimeout(() => this.tone(1320, 0.16, 'sine', 0.25), 90);
  }
}
