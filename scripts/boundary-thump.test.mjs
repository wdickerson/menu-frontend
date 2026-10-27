import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('bundled thump recording', () => {
  it('has 1.5x the original waveform amplitude within PCM rounding tolerance', () => {
    const wav = readFileSync(new URL('../public/assets/boundary-thump.wav', import.meta.url));
    let phase = 0;
    let maxRoundingDifference = 0;
    for (let sample = 0; sample < 9600; sample += 1) {
      const time = sample / 48000;
      const frequency = 280 * (220 / 280) ** Math.min(time / 0.16, 1);
      const gain = time < 0.012
        ? 0.0001 * (0.6 / 0.0001) ** (time / 0.012)
        : time < 0.18
          ? 0.6 * (0.0001 / 0.6) ** ((time - 0.012) / 0.168)
          : 0.0001 * (0.2 - time) / 0.02;
      const original = Math.round(Math.sin(phase) * gain * 32767);
      maxRoundingDifference = Math.max(maxRoundingDifference,
        Math.abs(wav.readInt16LE(44 + sample * 2) - original * 1.5));
      phase += 2 * Math.PI * frequency / 48000;
    }
    expect(maxRoundingDifference).toBeLessThanOrEqual(1);
  });

  it('is a non-silent 200 ms mono PCM WAV with the tuned sweep and gain envelope', () => {
    const wav = readFileSync(new URL('../public/assets/boundary-thump.wav', import.meta.url));
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // Mono
    const sampleRate = wav.readUInt32LE(24);
    expect(sampleRate).toBe(48000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.toString('ascii', 36, 40)).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(wav.length - 44);
    const sampleCount = (wav.length - 44) / 2;
    expect(sampleCount / sampleRate).toBe(0.2);
    const samples = Array.from({ length: sampleCount }, (_, index) => wav.readInt16LE(44 + index * 2));
    const peak = Math.max(...samples.map(Math.abs)) / 32767;
    expect(peak).toBeGreaterThan(0.825);
    expect(peak).toBeLessThanOrEqual(0.9);
    expect(samples[0]).toBe(0);
    expect(samples.at(-1)).toBe(0);
    // Count rising zero crossings near the head and tail of the sweep.
    const crossings = samples.flatMap((value, index) =>
      index > 0 && value > 0 && samples[index - 1] <= 0 ? [index] : []);
    const frequency = (start, end) =>
      sampleRate / (crossings[end] - crossings[start]) * (end - start);
    expect(frequency(0, 3)).toBeGreaterThan(270);
    expect(frequency(0, 3)).toBeLessThan(280);
    const last = crossings.length - 1;
    expect(frequency(last - 3, last)).toBeGreaterThan(215);
    expect(frequency(last - 3, last)).toBeLessThan(225);
  });
});