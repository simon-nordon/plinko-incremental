// Every sound is synthesised on the fly with WebAudio, so there are no asset files.

// Major pentatonic, so any run of peg hits sounds musical.
const PENTA = [0, 2, 4, 7, 9];
const noteHz = (semitonesFromA4: number) => 440 * Math.pow(2, semitonesFromA4 / 12);

interface ToneOpts {
  type?: OscillatorType;
  vol?: number;
  delay?: number;
  slide?: number;
  attack?: number;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private lastPeg = 0;
  private lastLand = 0;
  muted = false;

  /** Browsers only allow audio after a user gesture; call this from one. */
  unlock(): void {
    if (!this.ctx) {
      const ctx = new AudioContext();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 6;
      this.master = ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(comp).connect(ctx.destination);
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private live(): AudioContext | null {
    return this.ctx && !this.muted ? this.ctx : null;
  }

  private tone(freq: number, dur: number, o: ToneOpts = {}): void {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol ?? 0.15, t + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private noise(dur: number, vol: number, freq: number, delay = 0, type: BiquadFilterType = 'bandpass'): void {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  peg(row: number, kind: 'normal' | 'gold' | 'split', tier: number): void {
    tier = Math.min(tier, 4);
    const ctx = this.live();
    if (!ctx) return;
    // Throttle: with hundreds of balls, a peg click every frame is plenty.
    if (ctx.currentTime - this.lastPeg < 0.022) return;
    this.lastPeg = ctx.currentTime;
    const step = PENTA[row % 5] + 12 * Math.floor(row / 5);
    const f = noteHz(3 + step + tier * 2) * (1 + (Math.random() - 0.5) * 0.01);
    if (kind === 'gold') {
      this.tone(f * 2, 0.35, { type: 'sine', vol: 0.12 });
      this.tone(f * 3, 0.25, { type: 'sine', vol: 0.06, delay: 0.03 });
    } else if (kind === 'split') {
      this.tone(f, 0.18, { type: 'square', vol: 0.05, slide: f * 2 });
      this.tone(f * 1.5, 0.18, { type: 'triangle', vol: 0.08, delay: 0.04 });
    } else {
      this.tone(f, 0.07, { type: 'triangle', vol: 0.07 });
    }
  }

  land(mult: number, tier: number): void {
    tier = Math.min(tier, 4);
    const ctx = this.live();
    if (!ctx) return;
    if (ctx.currentTime - this.lastLand < 0.03 && mult < 3) return;
    this.lastLand = ctx.currentTime;
    if (mult < 1) {
      this.tone(160, 0.14, { type: 'sine', vol: 0.16, slide: 70 });
      this.noise(0.05, 0.06, 800);
      return;
    }
    const root = noteHz(-9 + tier * 2 + Math.min(12, Math.log2(mult) * 3));
    const chord = mult >= 10 ? [1, 1.26, 1.5, 2, 2.52] : mult >= 3 ? [1, 1.26, 1.5] : [1, 1.5];
    chord.forEach((r, i) => this.tone(root * r * 2, 0.35 + i * 0.05, { type: 'triangle', vol: 0.09, delay: i * 0.035 }));
    this.tone(root * 4, 0.12, { type: 'square', vol: 0.03 });
    if (mult >= 10) this.noise(0.6, 0.08, 6000, 0.05, 'highpass');
  }

  jackpot(): void {
    const seq = [0, 4, 7, 12, 16, 19, 24, 28];
    seq.forEach((s, i) => this.tone(noteHz(3 + s), 0.25, { type: 'square', vol: 0.06, delay: i * 0.05 }));
    this.noise(0.9, 0.1, 7000, 0.1, 'highpass');
  }

  tierSpawn(tier: number): void {
    // Stake levels are unbounded; keep the flourish short and within audible pitch.
    for (let i = 0; i < Math.min(tier, 4); i++) {
      this.tone(noteHz(15 + i * 5), 0.2, { type: 'sine', vol: 0.07, delay: i * 0.05 });
    }
  }

  buy(): void {
    this.tone(660, 0.07, { type: 'square', vol: 0.06 });
    this.tone(990, 0.12, { type: 'square', vol: 0.06, delay: 0.06 });
    this.tone(1320, 0.16, { type: 'triangle', vol: 0.06, delay: 0.1 });
  }

  deny(): void {
    this.tone(150, 0.15, { type: 'sawtooth', vol: 0.06, slide: 90 });
  }

  drop(): void {
    this.tone(300, 0.08, { type: 'sine', vol: 0.08, slide: 520 });
  }

  prestige(): void {
    this.tone(110, 1.6, { type: 'sawtooth', vol: 0.06, slide: 1760, attack: 0.2 });
    this.noise(1.6, 0.08, 3000, 0, 'bandpass');
    [0, 4, 7, 12, 16].forEach((s, i) =>
      this.tone(noteHz(3 + s), 1.4, { type: 'triangle', vol: 0.08, delay: 1.1 + i * 0.07 }),
    );
  }
}
