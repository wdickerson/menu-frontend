import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureMenuImage, MAX_IMAGE_BYTES, MAX_IMAGE_FILE_BYTES, MENU_API_URL, postMenuImages } from './menuApi';

const menu = { restaurantName: 'New Cafe', sections: [{ name: 'Lunch', items: ['Soup 8'] }] };
const image = () => new Blob(['jpeg'], { type: 'image/jpeg' });
const signal = () => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());

describe('menu API', () => {
  it('posts ordered image files with repeated images fields and a browser-generated boundary', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...menu, isDummy: false })));
    vi.stubGlobal('fetch', fetchMock);
    const abortSignal = signal();
    expect(await postMenuImages([image(), image()], abortSignal)).toEqual(menu);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(MENU_API_URL);
    expect(options.method).toBe('POST');
    expect(options.signal).toBe(abortSignal);
    expect(options.headers).toBeUndefined();
    const files = options.body.getAll('images') as File[];
    expect(files.map(({ name, type }) => ({ name, type }))).toEqual([
      { name: 'menu-1.jpg', type: 'image/jpeg' }, { name: 'menu-2.jpg', type: 'image/jpeg' },
    ]);
    expect([...options.body.keys()]).toEqual(['images', 'images']);
  });

  it('rejects invalid count, format, or combined size before making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const images of [[], Array.from({ length: 11 }, image), [new Blob(['png'], { type: 'image/png' })],
      [new Blob([], { type: 'image/jpeg' })],
      [new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)], { type: 'image/jpeg' })]]) {
      await expect(postMenuImages(images, signal())).rejects.toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows useful recoverable API errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'no_menu_found', message: 'No menu' },
    }), { status: 422 })));
    await expect(postMenuImages([image()], signal())).rejects.toThrow('Take clearer photos');
  });

  it('accepts exactly 250,000 bytes per image but never posts an image one byte over', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(menu)));
    vi.stubGlobal('fetch', fetchMock);
    const atLimit = new Blob([new Uint8Array(MAX_IMAGE_FILE_BYTES)], { type: 'image/jpeg' });
    expect(await postMenuImages([atLimit], signal())).toEqual(menu);
    expect(fetchMock.mock.calls[0][1].body.get('images').size).toBe(250_000);
    fetchMock.mockClear();
    const oversized = new Blob([new Uint8Array(MAX_IMAGE_FILE_BYTES + 1)], { type: 'image/jpeg' });
    await expect(postMenuImages([image(), oversized], signal())).rejects.toThrow('250 KB');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('handles gateway non-JSON errors and malformed success responses', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('Gateway failure', { status: 502 }))
      .mockResolvedValueOnce(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(postMenuImages([image()], signal())).rejects.toThrow('HTTP 502');
    await expect(postMenuImages([image()], signal())).rejects.toThrow('invalid menu');
  });

  it('propagates network errors and request cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(postMenuImages([image()], signal())).rejects.toThrow('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')));
    await expect(postMenuImages([image()], signal())).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('camera JPEG capture', () => {
  it('crops to match pinch zoom and resizes large camera frames', async () => {
    const drawImage = vi.fn();
    const toBlob = vi.fn((callback: BlobCallback) => callback(image()));
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob };
    vi.stubGlobal('document', { createElement: () => canvas });
    const video = { videoWidth: 6000, videoHeight: 4000 } as HTMLVideoElement;
    await captureMenuImage(video, 2);
    expect(drawImage).toHaveBeenCalledWith(video, 1500, 1000, 3000, 2000, 0, 0, 2400, 1600);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.88);
  });

  it('recompresses oversized JPEGs', async () => {
    let calls = 0;
    const toBlob = vi.fn((callback: BlobCallback) => callback(++calls === 1
      ? new Blob([new Uint8Array(MAX_IMAGE_FILE_BYTES + 1)], { type: 'image/jpeg' }) : image()));
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage: vi.fn() }), toBlob }) });
    expect((await captureMenuImage({ videoWidth: 1000, videoHeight: 800 } as HTMLVideoElement, 1)).size).toBe(4);
    expect(toBlob).toHaveBeenCalledTimes(2);
  });

  it('returns a capture exactly at the 250 KB limit without additional compression', async () => {
    const atLimit = new Blob([new Uint8Array(MAX_IMAGE_FILE_BYTES)], { type: 'image/jpeg' });
    const toBlob = vi.fn((callback: BlobCallback) => callback(atLimit));
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage: vi.fn() }), toBlob }) });
    expect(await captureMenuImage({ videoWidth: 1000, videoHeight: 800 } as HTMLVideoElement, 1)).toBe(atLimit);
    expect(toBlob).toHaveBeenCalledTimes(1);
  });

  it('reduces dimensions if quality changes alone cannot reach 250 KB', async () => {
    const oversized = new Blob([new Uint8Array(MAX_IMAGE_FILE_BYTES + 1)], { type: 'image/jpeg' });
    const drawImage = vi.fn();
    let calls = 0;
    const toBlob = vi.fn((callback: BlobCallback) => callback(++calls <= 4 ? oversized : image()));
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob };
    vi.stubGlobal('document', { createElement: () => canvas });
    const video = { videoWidth: 1000, videoHeight: 800 } as HTMLVideoElement;
    expect((await captureMenuImage(video, 1)).size).toBeLessThanOrEqual(MAX_IMAGE_FILE_BYTES);
    expect(drawImage).toHaveBeenLastCalledWith(video, 0, 0, 1000, 800, 0, 0, 800, 640);
  });

  it('rejects a capture that cannot be compressed rather than returning an oversized image', async () => {
    const oversized = new Blob([new Uint8Array(MAX_IMAGE_FILE_BYTES + 1)], { type: 'image/jpeg' });
    const toBlob = vi.fn((callback: BlobCallback) => callback(oversized));
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage: vi.fn() }), toBlob }) });
    await expect(captureMenuImage({ videoWidth: 1000, videoHeight: 800 } as HTMLVideoElement, 1))
      .rejects.toThrow('compressed to 250 KB');
    expect(toBlob).toHaveBeenCalledTimes(12);
  });

  it('handles an unready camera or a failed encoder', async () => {
    await expect(captureMenuImage({ videoWidth: 0, videoHeight: 0 } as HTMLVideoElement, 1))
      .rejects.toThrow('not ready');
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (callback: BlobCallback) => callback(null) }) });
    await expect(captureMenuImage({ videoWidth: 1000, videoHeight: 800 } as HTMLVideoElement, 1))
      .rejects.toThrow('could not be captured');
  });
});