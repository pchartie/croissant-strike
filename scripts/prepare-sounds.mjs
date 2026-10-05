// Prépare les sons d'armes à partir d'enregistrements CC0 (voir public/sounds/CREDITS.md) :
// découpe un coup de feu avec son écho, passe en mono 44,1 kHz 16 bits et
// normalise le volume.
//
// Utilisation : node scripts/prepare-sounds.mjs <dossier>
// où <dossier> contient « Prepared SFX Library/AR-15 », « …/1911 »,
// reload-rifle.wav et reload-pistol.wav (téléchargés depuis OpenGameArt).

import fs from 'node:fs';
import path from 'node:path';

const SOURCE = process.argv[2];
const OUT = path.resolve(import.meta.dirname, '../public/sounds');
const RATE = 44100;
const MAX_LENGTH = 1.6;
const FADE = 0.08;

if (!SOURCE) {
  console.error('Utilisation : node scripts/prepare-sounds.mjs <dossier des sons sources>');
  process.exit(1);
}
const library = path.join(SOURCE, 'Prepared SFX Library');

/** Sortie : [fichier source, numéro du coup de feu dans l'enregistrement, nom de sortie]. */
const SHOTS = [
  ['AR-15/D_24P.wav', 0, 'rifle-1.wav'],
  ['AR-15/D_24P.wav', 1, 'rifle-2.wav'],
  ['AR-15/D_32P.wav', 0, 'rifle-far.wav'],
  ['1911/A_34P.wav', 0, 'pistol-1.wav'],
  // Le 2e « coup » détecté juste après le 1er est un écho : le vrai 2e tir est le 3e.
  ['1911/A_34P.wav', 2, 'pistol-2.wav'],
  ['1911/A_42P.wav', 0, 'pistol-far.wav'],
];

fs.mkdirSync(OUT, { recursive: true });
for (const [file, index, name] of SHOTS) {
  const { samples, rate } = readWav(path.join(library, file));
  const mono = resample(samples, rate, RATE);
  const onset = findOnsets(mono)[index];
  if (onset === undefined) throw new Error(`${file} : coup de feu n°${index} introuvable`);
  const clip = trimTail(mono.subarray(Math.max(0, onset - Math.round(RATE * 0.005))));
  writeWav(path.join(OUT, name), normalize(clip));
  console.log(`  ${name} (${(clip.length / RATE).toFixed(2)} s)`);
}

for (const name of ['reload-rifle.wav', 'reload-pistol.wav']) {
  const { samples, rate } = readWav(path.join(SOURCE, name));
  const mono = resample(samples, rate, RATE);
  const start = Math.max(0, firstAbove(mono, 0.02) - Math.round(RATE * 0.02));
  const clip = mono.subarray(start);
  writeWav(path.join(OUT, name), normalize(clip, 0.7));
  console.log(`  ${name} (${(clip.length / RATE).toFixed(2)} s)`);
}
console.log(`Terminé : ${OUT}`);

/** Lit un WAV PCM 16 ou 24 bits ; renvoie le signal mono en flottants. */
function readWav(file) {
  const b = fs.readFileSync(file);
  let offset = 12;
  let format;
  while (offset + 8 <= b.length) {
    const id = b.toString('ascii', offset, offset + 4);
    const size = b.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      format = { channels: b.readUInt16LE(offset + 10), rate: b.readUInt32LE(offset + 12), bits: b.readUInt16LE(offset + 22) };
    } else if (id === 'data') {
      const { channels, rate, bits } = format;
      const bytes = bits / 8;
      const frames = Math.floor(size / (bytes * channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const o = offset + 8 + (i * channels + c) * bytes;
          sum += bits === 16 ? b.readInt16LE(o) / 32768 : b.readIntLE(o, 3) / 8388608;
        }
        samples[i] = sum / channels;
      }
      return { samples, rate };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`${file} : pas de données audio`);
}

/** Change la fréquence d'échantillonnage, avec un filtre moyenneur contre le repliement. */
function resample(input, from, to) {
  if (from === to) return input;
  const ratio = from / to;
  const width = Math.max(1, Math.round(ratio));
  const output = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < output.length; i++) {
    const center = Math.floor(i * ratio);
    let sum = 0;
    let count = 0;
    for (let k = center - (width >> 1); k <= center + (width >> 1); k++) {
      if (k >= 0 && k < input.length) {
        sum += input[k];
        count++;
      }
    }
    output[i] = sum / count;
  }
  return output;
}

/** Débuts des coups de feu : passages au-dessus de la moitié du pic, espacés d'au moins 80 ms. */
function findOnsets(signal) {
  let peak = 0;
  for (const v of signal) peak = Math.max(peak, Math.abs(v));
  const onsets = [];
  let last = -Infinity;
  for (let i = 0; i < signal.length; i++) {
    if (Math.abs(signal[i]) > peak * 0.5 && i - last > RATE * 0.08) {
      onsets.push(firstAbove(signal.subarray(Math.max(0, i - RATE * 0.01), i + 1), peak * 0.05) + Math.max(0, i - RATE * 0.01));
      last = i;
    }
    if (Math.abs(signal[i]) > peak * 0.5) last = i;
  }
  return onsets;
}

function firstAbove(signal, threshold) {
  for (let i = 0; i < signal.length; i++) if (Math.abs(signal[i]) > threshold) return i;
  return 0;
}

/** Garde le coup de feu et son écho jusqu'à -50 dB (au plus 1,6 s), avec un fondu en sortie. */
function trimTail(signal) {
  const window = Math.round(RATE * 0.02);
  let peak = 0;
  for (let i = 0; i < Math.min(signal.length, RATE * 0.1); i++) peak = Math.max(peak, Math.abs(signal[i]));
  let end = Math.min(signal.length, Math.round(RATE * MAX_LENGTH));
  for (let s = Math.round(RATE * 0.1); s < end; s += window) {
    let level = 0;
    for (let i = s; i < Math.min(s + window, signal.length); i++) level = Math.max(level, Math.abs(signal[i]));
    if (level < peak * 0.003) {
      end = s;
      break;
    }
  }
  const clip = Float32Array.from(signal.subarray(0, end));
  const fade = Math.round(RATE * FADE);
  for (let i = 0; i < fade && i < clip.length; i++) clip[clip.length - 1 - i] *= i / fade;
  return clip;
}

function normalize(signal, target = 0.9) {
  let peak = 0;
  for (const v of signal) peak = Math.max(peak, Math.abs(v));
  return signal.map((v) => (v / peak) * target);
}

function writeWav(file, signal) {
  const data = Buffer.alloc(signal.length * 2);
  signal.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}
