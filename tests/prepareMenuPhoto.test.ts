import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageDimensionsFromData } from 'image-dimensions';
import { MAX_PHOTO_BYTES } from '../src/menuApi';
import { prepareMenuPhoto } from '../src/prepareMenuPhoto';

vi.mock('image-dimensions', () => ({ imageDimensionsFromData: vi.fn() }));

describe('on-device menu photo preparation', () => {
  const close = vi.fn();
  const drawImage = vi.fn();
  const fillRect = vi.fn();
  const bitmap = { width: 4000, height: 3000, close };

  beforeEach(() => {
    vi.mocked(imageDimensionsFromData).mockReturnValue({ width: 4000, height: 3000, type: 'jpeg' });
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage, fillRect } as unknown as CanvasRenderingContext2D);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('preserves oriented aspect ratio and high resolution, converting to bounded JPEG', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => {
      callback(new Blob([new Uint8Array(200_000)], { type }));
    });
    const original = new File(['original bytes'], 'phone.png', { type: 'image/png' });
    const result = await prepareMenuPhoto(original);
    expect(result.width).toBe(2560);
    expect(result.height).toBe(1920);
    expect(result.file.type).toBe('image/jpeg');
    expect(result.file.size).toBeLessThanOrEqual(MAX_PHOTO_BYTES);
    expect(createImageBitmap).toHaveBeenCalledWith(original, { imageOrientation: 'from-image' });
    expect(fillRect).toHaveBeenCalledWith(0, 0, 2560, 1920);
    expect(close).toHaveBeenCalledOnce();
  });

  it('lowers quality then resolution until the byte limit is met', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback, type, quality) {
      const size = this.width < 2560 && Number(quality) <= 0.8 ? 240_000 : 300_000;
      callback(new Blob([new Uint8Array(size)], { type }));
    });
    const result = await prepareMenuPhoto(new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' }));
    expect(result.file.size).toBe(240_000);
    expect(result.width).toBe(2099);
    expect(result.height).toBe(1574);
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledTimes(6);
  });

  it('never upscales small originals', async () => {
    vi.mocked(createImageBitmap).mockResolvedValue({ ...bitmap, width: 800, height: 600 } as ImageBitmap);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => callback(new Blob(['jpeg'], { type })));
    const result = await prepareMenuPhoto(new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' }));
    expect([result.width, result.height]).toEqual([800, 600]);
  });

  it('releases decoding resources when encoding fails', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(null));
    await expect(prepareMenuPhoto(new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' }))).rejects.toThrow('could not prepare');
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects empty files, oversized originals and non-photo documents before decoding', async () => {
    await expect(prepareMenuPhoto(new File([], 'empty.jpg', { type: 'image/jpeg' }))).rejects.toThrow('empty');
    await expect(prepareMenuPhoto(new File([new Uint8Array(40_000_001)], 'huge.jpg', { type: 'image/jpeg' }))).rejects.toThrow('40 MB');
    await expect(prepareMenuPhoto(new File(['pdf'], 'menu.pdf', { type: 'application/pdf' }))).rejects.toThrow('still photo');
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('rejects huge compressed pixel counts before allocating a bitmap', async () => {
    vi.mocked(imageDimensionsFromData).mockReturnValue({ width: 12000, height: 12000, type: 'png' });
    await expect(prepareMenuPhoto(new File(['tiny compressed file'], 'panorama.png', { type: 'image/png' })))
      .rejects.toThrow('too many pixels');
    expect(createImageBitmap).not.toHaveBeenCalled();
  });
});