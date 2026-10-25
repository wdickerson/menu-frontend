import { afterEach, describe, expect, it, vi } from 'vitest';
import { MENU_ONLINE_TRANSCRIBE_API_URL } from './menuApi';
import { postOnlineMenu } from './menuOnlineTranscription';

const selected = { venue_identifier: 'Cafe Columbia City', menu_identifier: 'Dinner',
  source_url: 'https://example.test/dinner.pdf', agent_instructions: 'PRIVATE guidance for extracting dinner.' };
const menu = { restaurantName: 'Cafe', sections: [{ name: 'Dinner', items: ['Soup $8'] }] };
const signal = () => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());

describe('online menu transcription API', () => {
  it('posts exactly one complete menu and its original query as JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...menu, isDummy: false, extra: 'discard' })));
    vi.stubGlobal('fetch', fetchMock);
    const abortSignal = signal();
    expect(await postOnlineMenu('  Original dinner query  ', selected, abortSignal)).toEqual(menu);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(MENU_ONLINE_TRANSCRIBE_API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Original dinner query', menu: selected }), signal: abortSignal,
    });
  });

  it.each([
    { sections: [{ name: 'Hours', items: [] }] },
    { sections: [{ name: '', items: [] }, ...menu.sections, { name: 'Hours', items: [] }] },
    { sections: [{ name: '', items: ['Soup $8'] }] },
  ])('accepts empty sections and blank headings: $sections', async ({ sections }) => {
    const responseMenu = { ...menu, sections };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(responseMenu))));
    expect(await postOnlineMenu('Dinner', selected, signal())).toEqual(responseMenu);
  });

  it('does not derive the selected source from private instructions or discard blank fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(menu)));
    vi.stubGlobal('fetch', fetchMock);
    const unusual = { ...selected, venue_identifier: '', source_url: 'not a URL',
      agent_instructions: 'Use https://different.example/menu.pdf when appropriate.' };
    await postOnlineMenu('Dinner', unusual, signal());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).menu).toEqual(unusual);
  });

  it.each(['', ' \n ', 'x'.repeat(501)])('rejects unusable original query %j before fetch', async (query) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(postOnlineMenu(query, selected, signal())).rejects.toThrow('original search query');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bounds the complete UTF-8 JSON body before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(postOnlineMenu('Dinner', { ...selected, agent_instructions: '🦞'.repeat(20_000) }, signal()))
      .rejects.toThrow('too large');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { status: 422, code: 'no_menu_found', expected: 'could not be found' },
    { status: 422, code: 'illegible_text', expected: 'could not be read' },
    { status: 503, code: 'transcription_disabled', expected: 'currently unavailable' },
    { status: 504, code: 'openai_timeout', expected: 'took too long' },
    { status: 502, code: 'invalid_openai_response', expected: 'HTTP 502' },
  ])('provides safe recoverable HTTP $status/$code errors', async ({ status, code, expected }) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code, message: 'PRIVATE upstream information' },
    }), { status })));
    await expect(postOnlineMenu('Dinner', selected, signal())).rejects.toThrow(expected);
  });

  it.each([{}, { ...menu, sections: [] }, { ...menu, sections: [{ name: 'Dinner', items: [1] }] }])
    ('rejects menus that cannot be loaded', async (invalid) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(invalid))));
      await expect(postOnlineMenu('Dinner', selected, signal())).rejects.toThrow('invalid menu');
    });

  it('handles non-JSON gateway errors and network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('Gateway failure', { status: 502 }))
      .mockRejectedValueOnce(new TypeError('Offline')));
    await expect(postOnlineMenu('Dinner', selected, signal())).rejects.toThrow('HTTP 502');
    await expect(postOnlineMenu('Dinner', selected, signal())).rejects.toThrow('Offline');
  });

  it('does not fetch an already-aborted request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(postOnlineMenu('Dinner', selected, controller.signal)).rejects.toBe(controller.signal.reason);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects late response parsing after cancellation even if the transport ignores abort', async () => {
    const controller = new AbortController();
    let finish!: (data: unknown) => void;
    const response = new Response();
    vi.spyOn(response, 'json').mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const result = postOnlineMenu('Dinner', selected, controller.signal);
    await Promise.resolve();
    controller.abort();
    finish(menu);
    await expect(result).rejects.toBe(controller.signal.reason);
  });
});