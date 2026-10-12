import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PHOTO_BYTES, MENU_API_URL, parseRestaurantMenu, submitMenuImages } from '../src/menuApi';

const menu = { restaurantName: 'New Café', sections: [{ name: 'Drinks', items: ['Coffee. $4.'] }] };
const photo = (name = 'original.jpg', size = 100) => new File([new Uint8Array(size)], name, { type: 'image/jpeg' });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe('menu API client', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => { vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('sends ordered, repeated binary images to the hardcoded endpoint without setting Content-Type', async () => {
    fetchMock.mockResolvedValue(json({ isDummy: false, ...menu }));
    expect(await submitMenuImages([photo('first.jpg'), photo('second.jpg')], new AbortController().signal)).toEqual(menu);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(MENU_API_URL);
    expect(options?.method).toBe('POST');
    expect(options?.headers).toBeUndefined();
    expect(options?.credentials).toBe('omit');
    const body = options?.body as FormData;
    expect(Array.from(body.keys())).toEqual(['images', 'images']);
    expect(body.getAll('images').map((file) => (file as File).name)).toEqual(['menu-page-1.jpg', 'menu-page-2.jpg']);
    expect(body.getAll('images').map((file) => (file as File).size)).toEqual([100, 100]);
  });

  it('rejects invalid counts and oversized/unprepared photos without making a request', async () => {
    const signal = new AbortController().signal;
    await expect(submitMenuImages([], signal)).rejects.toThrow('between 1 and 10');
    await expect(submitMenuImages(Array.from({ length: 11 }, () => photo()), signal)).rejects.toThrow('between 1 and 10');
    await expect(submitMenuImages([photo('large.jpg', MAX_PHOTO_BYTES + 1)], signal)).rejects.toThrow('not ready');
    await expect(submitMenuImages([new File(['png'], 'page.png', { type: 'image/png' })], signal)).rejects.toThrow('not ready');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['no_menu_found', 422, 'No menu was found'],
    ['illegible_text', 422, 'good light'],
    ['openai_rate_limited', 503, 'busy'],
    ['transcription_disabled', 503, 'not available'],
    ['openai_timeout', 504, 'took too long'],
  ])('maps %s to actionable, safe feedback', async (code, status, message) => {
    fetchMock.mockResolvedValue(json({ error: { code, message: 'PRIVATE SERVER DETAILS' } }, status));
    await expect(submitMenuImages([photo()], new AbortController().signal)).rejects.toThrow(message);
    expect(fetchMock).toHaveBeenCalledTimes(1); // Never retry a potentially paid POST automatically.
  });

  it('handles non-JSON gateway errors and network failures', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<h1>Bad Gateway</h1>', { status: 502 }));
    await expect(submitMenuImages([photo()], new AbortController().signal)).rejects.toThrow('photos are still here');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(submitMenuImages([photo()], new AbortController().signal)).rejects.toThrow('internet connection');
  });

  it.each([
    { isDummy: true, ...menu },
    { isDummy: false, restaurantName: 'Café', sections: [] },
    { isDummy: false, restaurantName: 'Café', sections: [{ name: 'Food', items: [] }] },
    { isDummy: false, restaurantName: 'Café', sections: [{ name: 'Food', items: [42] }] },
  ])('rejects dummy or malformed success responses instead of crashing the reader', async (body) => {
    fetchMock.mockResolvedValue(json(body));
    await expect(submitMenuImages([photo()], new AbortController().signal)).rejects.toThrow();
  });

  function rejectOnAbort() {
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
  }

  it('aborts on user cancellation', async () => {
    rejectOnAbort();
    const controller = new AbortController();
    const promise = submitMenuImages([photo()], controller.signal);
    const assertion = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
  });

  it('times out with no automatic retry', async () => {
    vi.useFakeTimers();
    rejectOnAbort();
    const promise = submitMenuImages([photo()], new AbortController().signal);
    const assertion = expect(promise).rejects.toThrow('connection timed out');
    await vi.advanceTimersByTimeAsync(45_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('trims and copies valid stored menu text', () => {
    expect(parseRestaurantMenu({ restaurantName: ' Café ', sections: [{ name: ' Food ', items: [' Soup. '] }] }))
      .toEqual({ restaurantName: 'Café', sections: [{ name: 'Food', items: ['Soup.'] }] });
    expect(() => parseRestaurantMenu({ restaurantName: 'Café', sections: [{ name: 'Food', items: [' '] }] })).toThrow();
  });
});