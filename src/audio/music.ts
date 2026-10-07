/**
 * Looping background music for the game.
 *
 * Music bank — every clip in public/audio/music/ is played as an infinite loop
 * and crossfades into the next when a new track is requested. Tracks are chosen
 * from a shuffled, non-repeating deck: pickNext() hands out a different random
 * track each time and only cycles back to one after every other track has been
 * used up (so no two consecutive games share a track). Mute is implemented at
 * the AudioContext level so all sources pause with their position preserved.
 */
const TRACKS = [
       'melodic-balanced-lofi.mp3',
       'melodic-brandbook-mas1.mp3',
       'melodic-modulah.mp3',
       'melodic-zloyzloy-mas3.mp3',
 ] as const;
const CROSSFADE = 1.2;              // seconds, head-to-tail blend between tracks
type TrackIndex = number;          // index into TRACKS by full filename

export class Music {
   current: TrackIndex = -1;        // last track played, or -1 before the first
    /** Current mute state — drives ctx.suspend / resume. */
    muted = false;
    /** Master mix bus level (0..1). */
    gain = 0.6;

    private ctx: AudioContext | null = null;
    private master: GainNode | null = null;
    private buffers: (AudioBuffer | null)[] = [];
    private source: AudioBufferSourceNode | null = null;
    private voice: GainNode | null = null;
    private loading: Promise<void> | null = null;
     /** Remaining shuffles, most-recent at the top of the stack. */
     private remaining: number[] = [];

    /**
    * Ensure the context exists and buffers are ready. Called on a user gesture.
      It also resumes the clock after a mute, but does NOT start a track — that
      is pickNext()'s job, so a new game can request its own fresh track.
    */
   unlock(): void {
       if (!this.ctx || !this.master) this.build();
        void this.ensureLoaded().then(() => {
          if (!this.muted && this.ctx?.state === 'suspended') void this.ctx.resume();
        });
     }

    /**
     * Start the next random, non-repeating track and crossfade into it. This is
      what a new game calls; it advances the deck so no track repeats until the
      whole bank has cycled through.
    */
   pickNext(): void {
       void this.ensureLoaded().then(() => {
         const index = this.nextIndex();
          if (index >= 0) this.play(index);
        });
     }

    /** Switch to a specific track by name or index, crossfading from active. */
   async start(nameOrIndex: string | number): Promise<boolean> {
        await this.ensureLoaded();
       const index = typeof nameOrIndex === 'string'
          ? (TRACKS as readonly string[]).indexOf(nameOrIndex)
         : nameOrIndex;
        if (index < 0 || index >= TRACKS.length) return false;
       return this.play(index);
     }

    /** Toggle mute via ctx.suspend/resume, preserving each source's position. */
   setMuted(muted: boolean): void {
        this.muted = muted;
        if (!this.ctx) return;
         const state = this.ctx.state;
         if (muted && state === 'running') void this.ctx.suspend();
        else if (!muted && state !== 'running') void this.ctx.resume();
      }

    /** Pop the next index from a shuffled, non-repeating deck that skips
     * buffers that failed to decode; reshuffles when the deck runs dry. */
   private nextIndex(): number {
       let attempts = 0;
        while (attempts++ < TRACKS.length * 2) {
         if (this.remaining.length === 0) this.shuffleDeck();
          const idx = this.remaining.pop()!;
           // Skip clips that couldn't be decoded (e.g. a transient fetch failure).
           if (this.buffers[idx]) return idx;
        }
        return -1;                 // nothing decodable yet — caller does nothing
      }

     /** Fill the remaining deck with a Fisher-Yates shuffle of all indices. */
   private shuffleDeck(): void {
        const deck = TRACKS.map((_, i) => i);
        for (let i = deck.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
         }
        this.remaining = deck;
      }

     /** Build the AudioContext on first demand (lazy — avoids autoplay warnings). */
   private build(): void {
       const AC: typeof AudioContext | undefined = window.AudioContext
            ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!AC) return;
        this.ctx = new AC();
         const master = this.ctx.createGain();
          master.gain.value = this.gain;
          master.connect(this.ctx.destination);
         this.master = master;
      }

    /** Load every clip buffer exactly once via decodeAudioData. */
   private async ensureLoaded(): Promise<void> {
       if (this.loading) { await this.loading; return; }
        if (!this.ctx || !this.master) this.build();
        const ctx = this.ctx;
          if (!ctx) return;
         this.buffers.length = TRACKS.length;
           this.loading = Promise.all(
             TRACKS.map(async (name, i) => {
               try {
                    const response = await fetch(`${import.meta.env.BASE_URL}audio/music/${name}`);
                  if (!response.ok) return;
                 this.buffers[i] = await ctx.decodeAudioData(await response.arrayBuffer());
                } catch {
                    // Keep the slot null — nextIndex() skips it instead of failing.
                }
              }),
            ).then(() => undefined);
          await this.loading;
        }

      /** Crossfade a new looping source into the shared master bus. */
   private play(index: TrackIndex): boolean {
        if (index < 0 || index >= TRACKS.length) return false;
         const buffer = this.buffers[index];
          if (!buffer || !this.ctx || !this.master) return false;

           // Fade out whatever is looping now and let the tail ring out.
           if (this.source && this.voice) {
             const t0 = this.ctx.currentTime;
              const oldSrc = this.source;
               const oldVoice = this.voice;
             oldVoice.gain.cancelScheduledValues(t0);
            oldVoice.gain.setValueAtTime(oldVoice.gain.value, t0)
                .linearRampToValueAtTime(0.0001, t0 + CROSSFADE);
            oldSrc.onended = () => {
               try { oldSrc.disconnect(); } catch { /* already gone */ }
              try { oldVoice.disconnect(); } catch { /* already gone */ }
             };
            oldSrc.stop(t0 + CROSSFADE + 0.1);
            this.source = null;
            this.voice = null;
           }

         const ctx = this.ctx;
          const master = this.master;
          const src = ctx.createBufferSource();
           src.buffer = buffer;
            src.loop = true;             // infinite loop — no perfect seam required
         const voice = ctx.createGain();
          voice.gain.value = 0.0001;
          src.connect(voice).connect(master);

          const t = ctx.currentTime;
          voice.gain.setValueAtTime(0.0001, t)
             .linearRampToValueAtTime(this.gain, t + CROSSFADE);
        try { src.start(t); } catch { /* start() may throw if the ctx is closed */ }

         this.source = src;
          this.voice = voice;
          this.current = index;
          return true;
      }
}
