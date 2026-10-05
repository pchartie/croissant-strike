import type { WeaponDef } from '../weapons/definitions';

const MASTER_VOLUME = 0.4;
const BASE = `${import.meta.env.BASE_URL}sounds/`;

/** Enregistrements (public/sounds/), plusieurs variantes par son pour éviter la répétition. */
const SAMPLES: Record<string, string[]> = {
  rifle: ['rifle-1', 'rifle-2'],
  'rifle-far': ['rifle-far'],
  pistol: ['pistol-1', 'pistol-2'],
  'pistol-far': ['pistol-far'],
  'reload-rifle': ['reload-rifle'],
  'reload-pistol': ['reload-pistol'],
};

export interface ShotOptions {
  /** Tir lointain (bot) : prise de son à distance. */
  distant?: boolean;
  /** Volume relatif (0 à 1), selon la distance. */
  loudness?: number;
  /** Position gauche/droite, de -1 à 1. */
  pan?: number;
}

/**
 * Sons du jeu : les enregistrements de public/sounds/ une fois chargés, et
 * des sons synthétisés à la volée en attendant (ou s'ils manquent).
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private readonly buffers = new Map<string, AudioBuffer>();
  private reloadSource: AudioBufferSourceNode | null = null;

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

      void this.loadSamples(this.ctx);
    }
    void this.ctx.resume();
  }

  shot(def: WeaponDef, { distant = false, loudness = 1, pan = 0 }: ShotOptions = {}): void {
    const buffer = this.pick(distant ? `${def.id}-far` : def.id);
    if (buffer) this.play(buffer, { volume: (distant ? 1.2 : 0.8) * loudness, pan, rate: 0.96 + Math.random() * 0.08 });
    else this.synthShot(def, loudness);
  }

  /** Rechargement calé pour finir juste avant la fin de l'animation (chargeur enclenché, culasse). */
  reload(def: WeaponDef): void {
    this.stopReload();
    const buffer = this.pick(`reload-${def.id}`);
    if (!buffer) {
      const T = def.reloadTime;
      this.click(T * 0.2, 2200);
      this.click(T * 0.6, 1800);
      this.click(T * 0.85, 2600);
      return;
    }
    const delay = Math.max(0, def.reloadTime - buffer.duration - 0.2);
    this.reloadSource = this.play(buffer, { volume: 0.9, delay });
  }

  draw(): void {
    // Changer d'arme interrompt un rechargement en cours.
    this.stopReload();
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

  private async loadSamples(ctx: AudioContext): Promise<void> {
    const names = new Set(Object.values(SAMPLES).flat());
    await Promise.all(
      [...names].map(async (name) => {
        try {
          const response = await fetch(`${BASE}${name}.wav`);
          if (!response.ok) return;
          this.buffers.set(name, await ctx.decodeAudioData(await response.arrayBuffer()));
        } catch {
          // Son absent ou illisible : on garde le son synthétisé.
        }
      }),
    );
  }

  private pick(sound: string): AudioBuffer | null {
    const loaded = (SAMPLES[sound] ?? []).map((name) => this.buffers.get(name)).filter((b) => b !== undefined);
    return loaded.length > 0 ? loaded[Math.floor(Math.random() * loaded.length)] : null;
  }

  private play(
    buffer: AudioBuffer,
    { volume = 1, pan = 0, rate = 1, delay = 0 }: { volume?: number; pan?: number; rate?: number; delay?: number },
  ): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    source.connect(gain).connect(panner).connect(this.master);
    source.start(ctx.currentTime + delay);
    return source;
  }

  private stopReload(): void {
    try {
      this.reloadSource?.stop();
    } catch {
      // Déjà terminé.
    }
    this.reloadSource = null;
  }

  /** Coup de feu synthétisé : bruit filtré pour la détonation, plus une basse pour l'impact. */
  private synthShot(def: WeaponDef, loudness: number): void {
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
    source.connect(filter).connect(this.envelope(t, volume, decay)).connect(this.master);
    source.start(t, Math.random() * 0.5, decay + 0.05);

    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(thump, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    osc.connect(this.envelope(t, volume * 0.9, 0.14)).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.15);
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

  private envelope(t: number, volume: number, decay: number): GainNode {
    const gain = this.ctx!.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + decay);
    return gain;
  }
}
