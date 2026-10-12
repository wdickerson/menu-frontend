import { describe, expect, it, vi } from 'vitest';
import { setCameraTorch, supportsTorch } from './cameraTorch';

function cameraTrack(torch = true) {
  return { readyState: 'live', getCapabilities: () => ({ torch }),
    applyConstraints: vi.fn().mockResolvedValue(undefined) };
}

describe('camera flashlight', () => {
  it('detects a supported flashlight', () => {
    expect(supportsTorch(cameraTrack() as unknown as MediaStreamTrack)).toBe(true);
  });

  it('handles unsupported, missing, stopped, and throwing capability APIs safely', () => {
    for (const track of [undefined, cameraTrack(false), { ...cameraTrack(), readyState: 'ended' },
      { ...cameraTrack(), getCapabilities: undefined },
      { ...cameraTrack(), getCapabilities: () => { throw new Error('Unsupported'); } }]) {
      expect(supportsTorch(track as unknown as MediaStreamTrack | undefined)).toBe(false);
    }
  });

  it('applies the torch constraint for on and off', async () => {
    const track = cameraTrack();
    await setCameraTorch(track as unknown as MediaStreamTrack, true);
    await setCameraTorch(track as unknown as MediaStreamTrack, false);
    expect(track.applyConstraints.mock.calls).toEqual([
      [{ advanced: [{ torch: true }] }], [{ advanced: [{ torch: false }] }],
    ]);
  });

  it('never applies constraints to an unsupported camera', async () => {
    const track = cameraTrack(false);
    await expect(setCameraTorch(track as unknown as MediaStreamTrack, true)).rejects.toThrow('not supported');
    expect(track.applyConstraints).not.toHaveBeenCalled();
  });

  it('propagates a rejected flashlight constraint', async () => {
    const track = cameraTrack();
    track.applyConstraints.mockRejectedValue(new Error('Rejected'));
    await expect(setCameraTorch(track as unknown as MediaStreamTrack, true)).rejects.toThrow('Rejected');
  });
});