import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('standard bundled thump recording', () => {
  const wav = readFileSync(new URL('../public/assets/boundary-thump.wav', import.meta.url));

  it('preserves the existing Android and desktop recording', () => {
    expect(createHash('sha256').update(wav.subarray(44)).digest('hex'))
      .toBe('f574ae5f9b9a6cefb1a6fe913f9ab11220b931a77215d172f294f233748819ad');
  });

  it('has about 50% more RMS amplitude than the previous recording without clipping', () => {
    // Measured before the boost; soft limiting avoids clipping at 1.5x RMS.
    const previousRms = 0.1449056277829224;
    let energy = 0;
    for (let offset = 44; offset < wav.length; offset += 2) {
      const sample = wav.readInt16LE(offset);
      expect(Math.abs(sample)).toBeLessThan(32767);
      energy += (sample / 32767) ** 2;
    }
    const rms = Math.sqrt(energy / ((wav.length - 44) / 2));
    expect(rms / previousRms).toBeGreaterThan(1.49);
    expect(rms / previousRms).toBeLessThan(1.51);
  });

  it('is a non-silent, non-clipping 200 ms mono PCM WAV', () => {
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(48000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.toString('ascii', 36, 40)).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(wav.length - 44);
    const samples = Array.from({ length: (wav.length - 44) / 2 }, (_, index) => wav.readInt16LE(44 + index * 2));
    expect(samples.length / 48000).toBe(0.2);
    const peak = Math.max(...samples.map(Math.abs)) / 32767;
    expect(peak).toBeGreaterThan(0.95);
    expect(peak).toBeLessThanOrEqual(0.98);
    expect(samples[0]).toBe(0);
    expect(samples.at(-1)).toBe(0);
  });
});

describe('iOS bundled thump recording', () => {
  const standard = readFileSync(new URL('../public/assets/boundary-thump.wav', import.meta.url));
  const ios = readFileSync(new URL('../public/assets/boundary-thump-ios.wav', import.meta.url));
  const samples = Array.from({ length: (ios.length - 44) / 2 }, (_, index) => ios.readInt16LE(44 + index * 2));

  it('bundles a single damped knock without runtime sound processing', () => {
    expect(createHash('sha256').update(ios.subarray(44)).digest('hex'))
      .toBe('1259e34363ad5494c71dcd0e787c14a04d16e61bb4840c22b37ab4b7192f42df');
  });

  it('is a shorter 140 ms cue in the same mono PCM format', () => {
    expect(ios.toString('ascii', 0, 4)).toBe('RIFF');
    expect(ios.readUInt32LE(4)).toBe(ios.length - 8);
    expect(ios.subarray(8, 40)).toEqual(standard.subarray(8, 40));
    expect(ios.readUInt32LE(40)).toBe(ios.length - 44);
    expect(ios.length).toBe(13484);
    expect(samples.length / ios.readUInt32LE(24)).toBe(0.14);
  });

  it('retains a strong impact and peak headroom without clipping', () => {
    const standardSamples = Array.from({ length: (standard.length - 44) / 2 }, (_, index) => standard.readInt16LE(44 + index * 2));
    const energy = samples.reduce((sum, sample) => sum + sample ** 2, 0);
    const standardEnergy = standardSamples.reduce((sum, sample) => sum + sample ** 2, 0);
    const rmsRatio = Math.sqrt((energy / samples.length) / (standardEnergy / standardSamples.length));
    expect(rmsRatio).toBeGreaterThan(1.4);
    expect(rmsRatio).toBeLessThan(1.6);
    const peak = Math.max(...samples.map(Math.abs)) / 32767;
    expect(peak).toBeGreaterThan(0.96);
    expect(peak).toBeLessThan(0.98);
  });

  it('concentrates the energy into a prompt impact rather than a sustained tone', () => {
    const energy = (values) => values.reduce((sum, sample) => sum + sample ** 2, 0);
    const total = energy(samples);
    expect(energy(samples.slice(0, 48000 * 0.08)) / total).toBeGreaterThan(0.95);
    expect(energy(samples.slice(48000 * 0.11)) / total).toBeLessThan(0.01);
    const peak = Math.max(...samples.map(Math.abs));
    const peakIndex = samples.findIndex((sample) => Math.abs(sample) === peak);
    expect(peakIndex / 48000).toBeLessThan(0.02);
  });

  it('has softened edges, a quiet tail, and no large DC offset', () => {
    expect(samples[0]).toBe(0);
    expect(samples.at(-1)).toBe(0);
    expect(Math.max(...samples.slice(0, 10).map(Math.abs)) / 32767).toBeLessThan(0.02);
    expect(Math.max(...samples.slice(-48).map(Math.abs)) / 32767).toBeLessThan(0.001);
    const mean = samples.reduce((sum, sample) => sum + sample, 0) / samples.length / 32767;
    expect(Math.abs(mean)).toBeLessThan(0.005);
  });
});