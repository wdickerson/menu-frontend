import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RestaurantMenu } from './data/menus';
import { MENU_SHARE_API_URL } from './menuApi';
import { getSharedMenu, postSharedMenu } from './menuSharingApi';
import { isSharedMenuId } from './sharedMenuId';

const menu = { restaurantName: 'Cafe', sections: [{ name: 'Dinner', items: ['Soup $8'] }] };
const sharedMenuId = 'AbCdEf0123_-xy';
const signal = () => new AbortController().signal;
const invalidIds = [undefined, null, 12345678901234, {}, [], '', 'a'.repeat(13), 'a'.repeat(15),
  'abcdefghijklm/', 'abcdefghijklm+', 'abcdefghijklm=', 'abcdefghijklm ', 'abcdefghijklm\n',
  `${sharedMenuId}\n`, 'ébcdefghijklmn', '../abcdefghijk', 'abcd?efghijklm', 'abcd#efghijklm'];

afterEach(() => vi.unstubAllGlobals());

describe('shared menu IDs', () => {
  it.each([sharedMenuId, 'abcdefghijklmn', 'ABCDEFGHIJKLMN', '0123456789_-ab', '_'.repeat(14), '-'.repeat(14)])
    ('accepts exactly fourteen URL-safe characters: %j', (value) => {
      expect(isSharedMenuId(value)).toBe(true);
    });

  it.each(invalidIds.map((value) => ({ value })))('rejects invalid ID $value', ({ value }) => {
    expect(isSharedMenuId(value)).toBe(false);
  });
});

describe('postSharedMenu', () => {
  it('posts only the app menu content once, strips metadata at every level, and returns a validated ID', async () => {
    const input = { ...menu, sharedMenuId, id: 'captured-local', capturedAt: 'PRIVATE date', extra: 'PRIVATE',
      sections: [{ ...menu.sections[0], extra: 'PRIVATE section', items: [...menu.sections[0].items] }] };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ menu_id: sharedMenuId, extra: 'discard' })));
    vi.stubGlobal('fetch', fetchMock);
    const abortSignal = signal();
    const original = structuredClone(input);
    expect(await postSharedMenu(input, abortSignal)).toBe(sharedMenuId);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(MENU_SHARE_API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(menu), signal: abortSignal,
    });
    expect(input).toEqual(original);
  });

  it('does not impose a size limit on metadata that is omitted from the request', async () => {
    const input = { ...menu, metadata: 'x'.repeat(300_001) };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ menu_id: sharedMenuId }))));
    expect(await postSharedMenu(input, signal())).toBe(sharedMenuId);
  });

  it.each([null, undefined, {}, [], { ...menu, restaurantName: '' }, { ...menu, restaurantName: ' ' },
    { ...menu, sections: [] }, { ...menu, sections: [null] },
    { ...menu, sections: [{ name: 1, items: [] }] }, { ...menu, sections: [{ name: 'Food', items: null }] },
    { ...menu, sections: [{ name: 'Food', items: [1] }] }, { ...menu, sections: [{ name: 'Food', items: [' '] }] }]
    .map((value) => ({ value })))('rejects unusable input before fetching: $value', async ({ value }) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      await expect(postSharedMenu(value as RestaurantMenu, signal())).rejects.toThrow('menu is invalid');
      expect(fetchMock).not.toHaveBeenCalled();
    });

  it.each([
    { sections: [{ name: 'Hours', items: [] }] },
    { sections: [{ name: '', items: [] }, ...menu.sections, { name: 'Hours', items: [] }] },
    { sections: [{ name: '', items: ['Soup $8'] }] },
  ])('preserves empty sections and blank headings: $sections', async ({ sections }) => {
    const input = { ...menu, sections };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ menu_id: sharedMenuId })));
    vi.stubGlobal('fetch', fetchMock);
    await postSharedMenu(input, signal());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(input);
  });

  it.each(['x', 'é', '🦞'])('allows exactly 300,000 UTF-8 bytes and rejects one byte more with %s', async (character) => {
    const empty = { restaurantName: 'Cafe', sections: [{ name: 'Dinner', items: [''] }] };
    const availableBytes = 300_000 - new TextEncoder().encode(JSON.stringify(empty)).byteLength;
    const characterBytes = new TextEncoder().encode(character).byteLength;
    const item = character.repeat(Math.floor(availableBytes / characterBytes)) + 'x'.repeat(availableBytes % characterBytes);
    const input = { ...empty, sections: [{ name: 'Dinner', items: [item] }] };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ menu_id: sharedMenuId })));
    vi.stubGlobal('fetch', fetchMock);
    expect(new TextEncoder().encode(JSON.stringify(input)).byteLength).toBe(300_000);
    expect(await postSharedMenu(input, signal())).toBe(sharedMenuId);
    await expect(postSharedMenu({ ...input, restaurantName: 'Cafes' }, signal())).rejects.toThrow('too large');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('counts JSON escaping and the complete serialized envelope towards the byte limit', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const input = { ...menu, sections: [{ name: 'Dinner', items: ['"'.repeat(150_000)] }] };
    await expect(postSharedMenu(input, signal())).rejects.toThrow('too large');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([null, {}, { sharedMenuId }, { menu: { ...menu, sharedMenuId } },
    ...invalidIds.map((menu_id) => ({ menu_id }))].map((value) => ({ value })))
    ('rejects an invalid POST response $value', async ({ value }) => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(value)));
      vi.stubGlobal('fetch', fetchMock);
      await expect(postSharedMenu(menu, signal())).rejects.toThrow('invalid shared menu ID');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe('getSharedMenu', () => {
  it('gets the exact ID path and preserves the matching shared ID while projecting away response extras', async () => {
    const responseMenu = { ...menu, sharedMenuId, id: 'server-id', capturedAt: 'PRIVATE date', extra: 'PRIVATE',
      sections: [{ ...menu.sections[0], extra: 'PRIVATE section' }] };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(responseMenu)));
    vi.stubGlobal('fetch', fetchMock);
    const abortSignal = signal();
    const received = await getSharedMenu(sharedMenuId, abortSignal);
    expect(received).toEqual({ ...menu, sharedMenuId });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${MENU_SHARE_API_URL}/${sharedMenuId}`, {
      method: 'GET', signal: abortSignal,
    });
  });

  it.each(invalidIds.map((value) => ({ value })))('rejects an invalid requested ID before fetching: $value', async ({ value }) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(getSharedMenu(value as string, signal())).rejects.toThrow('link is invalid');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([null, {}, menu, { menu, sharedMenuId }, { menu: { ...menu, sharedMenuId } },
    { ...menu, sharedMenuId: 'ZyXwVu9876_-ab' }, { ...menu, sharedMenuId, restaurantName: '' },
    { ...menu, sharedMenuId, sections: [] }, { ...menu, sharedMenuId, sections: [null] },
    { ...menu, sharedMenuId, sections: [{ name: 'Food', items: [1] }] },
    ...invalidIds.map((value) => ({ ...menu, sharedMenuId: value }))].map((value) => ({ value })))
    ('rejects an invalid, wrapped, or mismatched GET response $value', async ({ value }) => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(value)));
      vi.stubGlobal('fetch', fetchMock);
      await expect(getSharedMenu(sharedMenuId, signal())).rejects.toThrow('invalid shared menu');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

  it.each([
    { sections: [{ name: 'Hours', items: [] }] },
    { sections: [{ name: '', items: [] }, ...menu.sections, { name: 'Hours', items: [] }] },
    { sections: [{ name: '', items: ['Soup $8'] }] },
  ])('preserves empty sections and blank headings: $sections', async ({ sections }) => {
    const responseMenu = { ...menu, sections, sharedMenuId };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(responseMenu))));
    expect(await getSharedMenu(sharedMenuId, signal())).toEqual(responseMenu);
  });
});

describe.each(['POST', 'GET'] as const)('shared menu %s failures and cancellation', (method) => {
  const request = (abortSignal: AbortSignal) => method === 'POST'
    ? postSharedMenu(menu, abortSignal) : getSharedMenu(sharedMenuId, abortSignal);
  const responseData = () => method === 'POST' ? { menu_id: sharedMenuId } : { ...menu, sharedMenuId };

  it.each([
    { status: 400, expected: 'HTTP 400' },
    { status: 404, expected: 'could not be found' },
    { status: 413, expected: 'too large' },
    { status: 429, expected: 'busy' },
    { status: 500, expected: 'HTTP 500' },
    { status: 502, expected: 'HTTP 502' },
    { status: 503, expected: 'currently unavailable' },
    { status: 504, expected: 'took too long' },
  ])('provides safe helpful HTTP $status errors without retries', async ({ status, expected }) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'PRIVATE code', message: 'PRIVATE upstream information' },
    }), { status }));
    vi.stubGlobal('fetch', fetchMock);
    const result = request(signal());
    await expect(result).rejects.toThrow(expected);
    await expect(result).rejects.not.toThrow('PRIVATE');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([404, 413, 502, 503])('handles non-JSON HTTP %s errors without leaking the body', async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('PRIVATE gateway information', { status }));
    vi.stubGlobal('fetch', fetchMock);
    const result = request(signal());
    await expect(result).rejects.toThrow(status === 404 ? 'could not be found'
      : status === 413 ? 'too large' : status === 503 ? 'currently unavailable' : 'HTTP 502');
    await expect(result).rejects.not.toThrow('PRIVATE');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects non-JSON successful responses without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('PRIVATE invalid response'));
    vi.stubGlobal('fetch', fetchMock);
    const result = request(signal());
    await expect(result).rejects.toThrow('invalid shared menu');
    await expect(result).rejects.not.toThrow('PRIVATE');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives a safe recoverable network error without retrying', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('PRIVATE network information'));
    vi.stubGlobal('fetch', fetchMock);
    const result = request(signal());
    await expect(result).rejects.toThrow('Check your connection');
    await expect(result).rejects.not.toThrow('PRIVATE');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not fetch an already-aborted request and preserves its reason', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort(new Error('Cancelled by user'));
    await expect(request(controller.signal)).rejects.toBe(controller.signal.reason);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves an AbortError from the transport rather than wrapping it as a network error', async () => {
    const error = new DOMException('Aborted', 'AbortError');
    const fetchMock = vi.fn().mockRejectedValue(error);
    vi.stubGlobal('fetch', fetchMock);
    await expect(request(signal())).rejects.toBe(error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves the cancellation reason when an in-flight transport rejects', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new TypeError('Transport cancelled')), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const result = request(controller.signal);
    controller.abort('cancelled');
    await expect(result).rejects.toBe(controller.signal.reason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('rejects late response parsing after abort (JSON rejects: %s)', async (rejectJson) => {
    const controller = new AbortController();
    let finish!: (data: unknown) => void;
    let fail!: (error: unknown) => void;
    const response = new Response();
    vi.spyOn(response, 'json').mockReturnValue(new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);
    const result = request(controller.signal);
    await Promise.resolve();
    controller.abort();
    if (rejectJson) fail(controller.signal.reason);
    else finish(responseData());
    await expect(result).rejects.toBe(controller.signal.reason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});