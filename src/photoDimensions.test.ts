import { describe, expect, it } from 'vitest';
import { readPhotoDimensions } from './photoDimensions';

function jpegHeader(width: number, height: number, orientation = 1, littleEndian = true) {
  const bytes = new Uint8Array(44);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0xffd8);
  view.setUint16(2, 0xffe1);
  view.setUint16(4, 34);
  bytes.set([0x45, 0x78, 0x69, 0x66, 0, 0], 6);
  view.setUint16(12, littleEndian ? 0x4949 : 0x4d4d);
  view.setUint16(14, 42, littleEndian);
  view.setUint32(16, 8, littleEndian);
  view.setUint16(20, 1, littleEndian);
  view.setUint16(22, 0x0112, littleEndian);
  view.setUint16(24, 3, littleEndian);
  view.setUint32(26, 1, littleEndian);
  view.setUint16(30, orientation, littleEndian);
  // Add a minimal SOF segment and an end marker after the EXIF segment.
  const header = new Uint8Array(51);
  header.set(bytes.slice(0, 38));
  const result = new DataView(header.buffer);
  result.setUint16(38, 0xffc0);
  result.setUint16(40, 9);
  result.setUint8(42, 8);
  result.setUint16(43, height);
  result.setUint16(45, width);
  result.setUint16(49, 0xffd9);
  return new Blob([header], { type: 'image/jpeg' });
}

describe('JPEG header dimensions', () => {
  it('reads dimensions without decoding the pixels', async () => {
    expect(await readPhotoDimensions(jpegHeader(6000, 4000))).toEqual({ width: 6000, height: 4000 });
  });

  it.each([5, 6, 7, 8])('handles rotated EXIF orientation %i', async (orientation) => {
    expect(await readPhotoDimensions(jpegHeader(6000, 4000, orientation))).toEqual({ width: 4000, height: 6000 });
  });

  it('handles big-endian EXIF', async () => {
    expect(await readPhotoDimensions(jpegHeader(6000, 4000, 6, false))).toEqual({ width: 4000, height: 6000 });
  });

  it('falls back for unknown formats and truncated headers', async () => {
    expect(await readPhotoDimensions(new Blob(['png']))).toBeNull();
    expect(await readPhotoDimensions(jpegHeader(6000, 4000).slice(0, 25))).toBeNull();
  });
});