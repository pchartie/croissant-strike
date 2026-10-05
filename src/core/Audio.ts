import type { WeaponDef } from '../weapons/definitions';

const MASTER_VOLUME = 0.4;

/** Sons synthétisés à la volée, en attendant de vrais fichiers audio. */
export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;

  /** Le navigateur n'autorise le son qu'après un clic : à appeler depuis un clic. */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = MASTER_VOLUME;
      this.master.connect(this.ctx.destination);

      const length = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    void this.ctx.resume();
  }

  /** Coup de feu : bruit filtré pour la détonation, plus une basse pour l'impact. */
  shot(def: WeaponDef, loudness = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { cutoff, thump, decay } = def.sound;
    const volume = def.sound.volume * loudness;
    const t = ctx.currentTime;

    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.playbackRate.value = 0.9 + Math.random() * 0.2;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(cutoff * 0.25, t + decay);
    const gain = this.envelope(t, volume, decay);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(t, Math.random() * 0.5, decay + 0.05);

    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(thump, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    osc.connect(this.envelope(t, volume * 0.9, 0.14)).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  /** Bruits mécaniques du chargeur qui sort, qui rentre, puis de la culasse. */
  reload(def: WeaponDef): void {
    const T = def.reloadTime;
    this.click(T * 0.2, 2200);
    this.click(T * 0.6, 1800);
    this.click(T * 0.85, 2600);
  }

  draw(): void {
    this.click(0, 2400);
  }

  dryFire(): void {
    this.click(0, 3200, 0.3);
  }

  /** Confirmation de touche : un « tic », ou un « ting » métallique pour la tête. */
  hit(headshot: boolean): void {
    if (headshot) this.tone(1900, 0.18, 0.35, 'triangle');
    else this.click(0, 4500, 0.35);
  }

  /** Le joueur est touché. */
  hurt(): void {
    this.tone(90, 0.12, 0.6, 'sine');
    this.click(0, 600, 0.5);
  }

  private tone(frequency: number, decay: number, volume: number, type: OscillatorType): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;
    osc.connect(this.envelope(t, volume, decay)).connect(this.master);
    osc.start(t);
    osc.stop(t + decay + 0.02);
  }

  private click(delay: number, frequency: number, volume = 0.5): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = 3;
    source.connect(filter).connect(this.envelope(t, volume, 0.04)).connect(this.master);
    source.start(t, Math.random() * 0.5, 0.06);
  }

  private envelope(t: number, volume: number, decay: number): GainNode {
    const gain = this.ctx!.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + decay);
    return gain;
  }
}
