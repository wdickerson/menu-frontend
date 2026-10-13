import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareMenuImage, MAX_IMAGE_BYTES, MAX_IMAGE_FILE_BYTES, MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT,
  MENU_API_URL, postMenuImages } from './menuApi';

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

  it('accepts exactly 350,000 bytes per image but never posts an image one byte over', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(menu)));
    vi.stubGlobal('fetch', fetchMock);
    const atLimit = new Blob([new Uint8Array(MAX_IMAGE_FILE_BYTES)], { type: 'image/jpeg' });
    expect(await postMenuImages([atLimit], signal())).toEqual(menu);
    expect(fetchMock.mock.calls[0][1].body.get('images').size).toBe(350_000);
    fetchMock.mockClear();
    const oversized = new Blob([new Uint8Array(MAX_IMAGE_FILE_BYTES + 1)], { type: 'image/jpeg' });
    await expect(postMenuImages([image(), oversized], signal())).rejects.toThrow('350 KB');
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

describe('native photo JPEG preparation', () => {
  function expectedDimensions(width: number, height: number) {
    if (Math.max(width, height) <= 1568) return { width, height };
    return width >= height
      ? { width: 1568, height: Math.max(1, Math.floor(height * 1568 / width)) }
      : { width: Math.max(1, Math.floor(width * 1568 / height)), height: 1568 };
  }

  function mockPhoto(width = 1000, height = 800, fails = false) {
    vi.stubGlobal('Image', class {
      naturalWidth = width;
      naturalHeight = height;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { if (fails) this.onerror?.(); else this.onload?.(); }
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:photo'), revokeObjectURL });
    return revokeObjectURL;
  }

  it.each([[6000, 4000], [4000, 6000], [6000, 2000], [2000, 6000], [6000, 6000],
    [MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT], [1569, 1000], [1000, 1569],
    [1567, 1200], [1200, 1567], [600, 400]])
    ('fits %i by %i photos inside configured limits without cropping or upscaling', async (width, height) => {
    const { width: outputWidth, height: outputHeight } = expectedDimensions(width, height);
    const revokeObjectURL = mockPhoto(width, height);
    const drawImage = vi.fn();
    const toBlob = vi.fn((callback: BlobCallback, _type?: string, _quality?: number) => callback(image()));
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob };
    vi.stubGlobal('document', { createElement: () => canvas });
    await prepareMenuImage(image());
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, outputWidth, outputHeight);
    expect(canvas.width).toBe(outputWidth);
    expect(canvas.height).toBe(outputHeight);
    expect(Math.max(canvas.width, canvas.height)).toBe(Math.min(1568, Math.max(width, height)));
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', expect.any(Number));
    const quality = toBlob.mock.calls[0][2];
    expect(quality).toBeGreaterThan(0);
    expect(quality).toBeLessThanOrEqual(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:photo');
  });

  it('recompresses oversized JPEGs', async () => {
    mockPhoto();
    let calls = 0;
    const toBlob = vi.fn((callback: BlobCallback) => callback(++calls === 1
      ? new Blob([new Uint8Array(MAX_IMAGE_FILE_BYTES + 1)], { type: 'image/jpeg' }) : image()));
    const drawImage = vi.fn();
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage }), toBlob }) });
    expect((await prepareMenuImage(image())).size).toBe(4);
    expect(toBlob).toHaveBeenCalledTimes(2);
    expect(drawImage).toHaveBeenCalledTimes(1);
  });

  it('returns a capture exactly at the 350 KB limit without additional compression', async () => {
    mockPhoto();
    const atLimit = new Blob([new Uint8Array(MAX_IMAGE_FILE_BYTES)], { type: 'image/jpeg' });
    const toBlob = vi.fn((callback: BlobCallback) => callback(atLimit));
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage: vi.fn() }), toBlob }) });
    expect(await prepareMenuImage(image())).toBe(atLimit);
    expect(toBlob).toHaveBeenCalledTimes(1);
  });

  it('reduces dimensions if quality changes alone cannot reach 350 KB', async () => {
    mockPhoto();
    const oversized = new Blob([new Uint8Array(MAX_IMAGE_FILE_BYTES + 1)], { type: 'image/jpeg' });
    const drawImage = vi.fn();
    let calls = 0;
    const toBlob = vi.fn((callback: BlobCallback) => callback(++calls <= 4 ? oversized : image()));
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob };
    vi.stubGlobal('document', { createElement: () => canvas });
    expect((await prepareMenuImage(image())).size).toBeLessThanOrEqual(MAX_IMAGE_FILE_BYTES);
    expect(drawImage).toHaveBeenLastCalledWith(expect.anything(), 0, 0, 800, 640);
    expect(drawImage).toHaveBeenCalledTimes(2);
  });

  it('rejects a capture that cannot be compressed rather than returning an oversized image', async () => {
    const revokeObjectURL = mockPhoto();
    const oversized = new Blob([new Uint8Array(MAX_IMAGE_FILE_BYTES + 1)], { type: 'image/jpeg' });
    const toBlob = vi.fn((callback: BlobCallback) => callback(oversized));
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage: vi.fn() }), toBlob }) });
    await expect(prepareMenuImage(image()))
      .rejects.toThrow('compressed to 350 KB');
    expect(toBlob).toHaveBeenCalledTimes(12);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:photo');
  });

  it('handles an empty image, invalid dimensions, or a failed encoder', async () => {
    await expect(prepareMenuImage(new Blob())).rejects.toThrow('empty');
    mockPhoto(0, 0);
    await expect(prepareMenuImage(image())).rejects.toThrow('invalid dimensions');
    const revokeObjectURL = mockPhoto();
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (callback: BlobCallback) => callback(null) }) });
    await expect(prepareMenuImage(image())).rejects.toThrow('could not be prepared');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:photo');
  });

  it('reports unsupported or corrupt images and cleans up their URLs', async () => {
    const revokeObjectURL = mockPhoto(1000, 800, true);
    await expect(prepareMenuImage(image())).rejects.toThrow('Use a JPEG');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:photo');
  });

  it('converts browser-decodable non-JPEG photos to JPEG', async () => {
    mockPhoto();
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (callback: BlobCallback) => callback(image()) }) });
    expect((await prepareMenuImage(new Blob(['png'], { type: 'image/png' }))).type).toBe('image/jpeg');
  });

  it.each([[6000, 4000], [4000, 6000], [6000, 6000], [1569, 1000], [1000, 1569],
    [1568, 1568], [1567, 1200], [1200, 1567], [600, 400]])
    ('decodes %i by %i JPEGs at the exact capped size without upscaling', async (width, height) => {
    // SOF header describing the original dimensions, followed by end-of-image.
    const file = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 9, 8,
      height >> 8, height & 0xff, width >> 8, width & 0xff, 0, 0, 0xff, 0xd9])]);
    const dimensions = expectedDimensions(width, height);
    const bitmap = { ...dimensions, close: vi.fn() };
    const createBitmap = vi.fn().mockResolvedValue(bitmap);
    const drawImage = vi.fn();
    vi.stubGlobal('createImageBitmap', createBitmap);
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage }),
      toBlob: (callback: BlobCallback) => callback(image()) }) });
    await prepareMenuImage(file);
    expect(createBitmap).toHaveBeenCalledWith(file, { imageOrientation: 'from-image',
      resizeWidth: dimensions.width, resizeHeight: dimensions.height, resizeQuality: 'high' });
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, dimensions.width, dimensions.height);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('falls back when resized bitmap decoding is unsupported', async () => {
    mockPhoto(6000, 4000);
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('Unsupported options')));
    const drawImage = vi.fn();
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage }),
      toBlob: (callback: BlobCallback) => callback(image()) }) });
    const file = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 9, 8, 0x0f, 0xa0, 0x17, 0x70, 0, 0, 0xff, 0xd9])]);
    expect((await prepareMenuImage(file)).type).toBe('image/jpeg');
    const dimensions = expectedDimensions(6000, 4000);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, dimensions.width, dimensions.height);
  });

  it('does not decode a photo cancelled before preparation starts', async () => {
    const controller = new AbortController();
    controller.abort();
    const createBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', createBitmap);
    await expect(prepareMenuImage(image(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(createBitmap).not.toHaveBeenCalled();
  });

  it('does not encode a photo cancelled during bitmap decoding and closes the result', async () => {
    const controller = new AbortController();
    const bitmap = { width: 1024, height: 682, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { controller.abort(); return bitmap; }));
    const file = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 9, 8, 0x0f, 0xa0, 0x17, 0x70, 0, 0, 0xff, 0xd9])]);
    await expect(prepareMenuImage(file, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('cancels fallback image loading promptly and releases its URL', async () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:loading', revokeObjectURL });
    const loadingImage = { onload: null, onerror: null, src: '' };
    vi.stubGlobal('Image', class { constructor() { return loadingImage; } });
    const controller = new AbortController();
    const prepared = prepareMenuImage(image(), controller.signal);
    controller.abort();
    await expect(prepared).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadingImage.src).toBe('');
    expect(loadingImage.onload).toBeNull();
    expect(loadingImage.onerror).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:loading');
  });
});