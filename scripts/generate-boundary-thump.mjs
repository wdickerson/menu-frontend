// Original, offline-generated recordings of the tuned boundary thump.
// Run with Node to regenerate the committed WAVs; no runtime synthesis/dependencies.
import { writeFileSync } from 'node:fs';

const sampleRate = 48000;
const duration = 0.2;
const sampleCount = Math.round(sampleRate * duration);
const dataSize = sampleCount * 2;
const wav = Buffer.alloc(44 + dataSize);
wav.write('RIFF', 0);
wav.writeUInt32LE(36 + dataSize, 4);
wav.write('WAVE', 8);
wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); // PCM
wav.writeUInt16LE(1, 22); // Mono
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(dataSize, 40);
const iosWav = Buffer.from(wav);

let phase = 0;
for (let sample = 0; sample < sampleCount; sample += 1) {
  const time = sample / sampleRate;
  const frequency = 280 * (220 / 280) ** Math.min(time / 0.16, 1);
  const gain = time < 0.012
    ? 0.0001 * (0.6 / 0.0001) ** (time / 0.012)
    : time < 0.18
      ? 0.6 * (0.0001 / 0.6) ** ((time - 0.012) / 0.168)
      : 0.0001 * (duration - time) / 0.02;
  // 1.5x the original amplitude, retaining the tuned envelope without clipping.
  const value = Math.sin(phase) * gain * 1.5;
  wav.writeInt16LE(Math.round(value * 32767), 44 + sample * 2);
  // Boost quiet portions without clipping the already-loud peak. The smooth
  // limiter retains the duration/sweep and leaves 2% PCM headroom on iOS.
  const louder = 0.98 * Math.tanh(2 * value) / Math.tanh(2 * 0.9);
  iosWav.writeInt16LE(Math.round(louder * 32767), 44 + sample * 2);
  phase += 2 * Math.PI * frequency / sampleRate;
}

writeFileSync(new URL('../public/assets/boundary-thump.wav', import.meta.url), wav);
writeFileSync(new URL('../public/assets/boundary-thump-ios.wav', import.meta.url), iosWav);