import type { WeaponDef } from '../weapons/definitions';

/** Gain général à 100 % de volume (70 % donne le niveau d'origine du jeu). */
const MAX_GAIN = 0.57;
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
  private volume = 0.7;

  /** Volume général, de 0 à 1. */
  setVolume(volume: number): void {
    this.volume = volume;
    if (this.ctx) this.master.gain.value = volume * MAX_GAIN;
  }

  /** Le navigateur n'autorise le son qu'après un clic : à appeler depuis un clic. */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume * MAX_GAIN;
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

  // --- Couteau (sons synthétisés) ---

  /** Lame qui fend l'air : plus long et plus grave pour le coup puissant. */
  knifeSwing(heavy: boolean): void {
    this.noiseBurst('bandpass', heavy ? 900 : 1500, 1.2, 0.45, heavy ? 0.3 : 0.18, heavy ? 0.25 : 0.03);
  }

  /** Lame qui touche un corps : impact sourd. */
  knifeHit(): void {
    this.noiseBurst('lowpass', 500, 0.8, 0.9, 0.16);
    this.sweep(160, 60, 0.12, 0.6, 0);
  }

  /** Lame contre un mur : tintement métallique. */
  knifeWall(): void {
    this.click(0, 3800, 0.6);
    this.tone(5200, 0.15, 0.12, 'triangle');
  }

  // --- Grenades (sons synthétisés) ---

  /** Dégoupillage : deux petits clics métalliques. */
  pin(): void {
    this.click(0, 2800, 0.4);
    this.click(0.06, 1800, 0.3);
  }

  throwWhoosh(): void {
    this.noiseBurst('bandpass', 700, 1, 0.3, 0.22);
  }

  bounce(loudness: number, pan: number): void {
    this.click(0, 1600 + Math.random() * 800, 0.35 * loudness, pan);
  }

  /** Explosion de HE : claquement, grondement grave et long. */
  explosion(loudness: number, pan: number): void {
    this.noiseBurst('bandpass', 1800, 0.8, 0.9 * loudness, 0.25, 0, pan);
    this.noiseBurst('lowpass', 450, 0.7, 1.4 * loudness, 1.5, 0, pan, 0.6);
    this.sweep(90, 28, 0.6, 1.1 * loudness, pan);
  }

  /** Détonation sèche de la flash. */
  flashbang(loudness: number, pan: number): void {
    this.noiseBurst('highpass', 1400, 0.7, 1.2 * loudness, 0.35, 0, pan);
    this.noiseBurst('lowpass', 600, 0.7, 0.6 * loudness, 0.5, 0, pan);
  }

  /** Sifflement d'oreilles quand on est aveuglé. */
  ring(duration: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.value = 3300;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  /** Fumigène : long sifflement de gaz. */
  smoke(loudness: number, pan: number): void {
    this.noiseBurst('bandpass', 3800, 0.6, 0.45 * loudness, 2.5, 0, pan);
  }

  /** Molotov : verre qui éclate, embrasement puis crépitement (ou extinction dans une fumée). */
  molotov(loudness: number, pan: number, fizzled: boolean, burnTime: number): void {
    this.noiseBurst('highpass', 3200, 0.8, 0.8 * loudness, 0.25, 0, pan);
    for (let i = 0; i < 5; i++) this.click(Math.random() * 0.15, 3000 + Math.random() * 3000, 0.4 * loudness, pan);
    if (fizzled) {
      this.noiseBurst('highpass', 2500, 0.7, 0.4 * loudness, 0.8, 0.1, pan);
      return;
    }
    this.noiseBurst('lowpass', 900, 0.7, 0.8 * loudness, 1.2, 0.05, pan);
    for (let i = 0; i < burnTime * 6; i++) {
      this.click(0.3 + Math.random() * burnTime, 900 + Math.random() * 2200, 0.18 * loudness, pan);
    }
  }

  /** Petit éclatement du leurre à la fin. */
  decoyPop(loudness: number, pan: number): void {
    this.noiseBurst('lowpass', 1200, 0.7, 0.7 * loudness, 0.3, 0, pan);
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

  private click(delay: number, frequency: number, volume = 0.5, pan = 0): void {
    this.noiseBurst('bandpass', frequency, 3, volume, 0.04, delay, pan);
  }

  /** Bruit filtré qui s'éteint en `decay` secondes, placé à gauche ou à droite. */
  private noiseBurst(
    type: BiquadFilterType,
    frequency: number,
    q: number,
    volume: number,
    decay: number,
    delay = 0,
    pan = 0,
    rate = 1,
  ): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0) return;
    const t = ctx.currentTime + delay;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    source.playbackRate.value = rate;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    source.connect(filter).connect(this.envelope(t, Math.min(volume, 2), decay)).connect(this.panner(pan)).connect(this.master);
    source.start(t, Math.random() * 0.5);
    source.stop(t + decay + 0.05);
  }

  /** Son grave qui descend (le « boum » des explosions). */
  private sweep(from: number, to: number, decay: number, volume: number, pan: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + decay);
    osc.connect(this.envelope(t, volume, decay)).connect(this.panner(pan)).connect(this.master);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }

  private panner(pan: number): StereoPannerNode {
    const node = this.ctx!.createStereoPanner();
    node.pan.value = Math.max(-1, Math.min(1, pan));
    return node;
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
