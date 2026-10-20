import { afterEach, describe, expect, it, vi } from 'vitest';

const deployedBaseUrl = 'https://we8asbpr8l.execute-api.us-east-1.amazonaws.com/prod';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('menu API environment URL', () => {
  it.each([undefined, '', '   ', '\t\n'])('falls back to both deployed operations for %s', async (value) => {
    vi.stubEnv('VITE_MENU_API_URL', value);
    vi.resetModules();
    const { MENU_API_URL, MENU_SEARCH_API_URL } = await import('./menuApi');
    expect(MENU_API_URL).toBe(`${deployedBaseUrl}/menu_image_transcribe`);
    expect(MENU_SEARCH_API_URL).toBe(`${deployedBaseUrl}/menu_online_search`);
  });

  it.each([
    { configured: '  http://127.0.0.1:8000/menu_image_transcribe  ', base: 'http://127.0.0.1:8000' },
    { configured: '\t http://localhost:8000/menu_online_search \n', base: 'http://localhost:8000' },
    { configured: 'https://api.example.test/prod/menu_image_transcribe', base: 'https://api.example.test/prod' },
    { configured: 'https://api.example.test/proxy/v1/stage/menu_online_search', base: 'https://api.example.test/proxy/v1/stage' },
    { configured: 'https://api.example.test/prod/menu_image_transcribe/', base: 'https://api.example.test/prod' },
    { configured: 'https://api.example.test/prod/menu_online_search///?debug=true#results', base: 'https://api.example.test/prod' },
    { configured: 'https://api.example.test/prod/menu_image_transcribe?operation=old#photos', base: 'https://api.example.test/prod' },
    { configured: 'http://127.0.0.1:8000/menus', base: 'http://127.0.0.1:8000' },
    { configured: '  https://api.example.test/proxy/stage/menus///?legacy=true#old  ', base: 'https://api.example.test/proxy/stage' },
  ])('derives sibling operations from $configured', async ({ configured, base }) => {
    vi.stubEnv('VITE_MENU_API_URL', configured);
    vi.resetModules();
    const { MENU_API_URL, MENU_SEARCH_API_URL } = await import('./menuApi');
    expect(MENU_API_URL).toBe(`${base}/menu_image_transcribe`);
    expect(MENU_SEARCH_API_URL).toBe(`${base}/menu_online_search`);
  });

  it('posts photos and search JSON to their configured sibling endpoints after legacy migration', async () => {
    vi.stubEnv('VITE_MENU_API_URL', '  http://127.0.0.1:8000/local/menus/?legacy=true#old  ');
    vi.resetModules();
    const { MENU_API_URL, MENU_SEARCH_API_URL, postMenuImages } = await import('./menuApi');
    const { searchMenusOnline } = await import('./menuSearchApi');
    const menu = { restaurantName: 'Local Cafe', sections: [{ name: 'Lunch', items: ['Soup'] }] };
    const possibleMenu = { venue_identifier: 'Local Cafe', menu_identifier: 'Lunch',
      source_url: 'https://example.test/lunch.pdf', agent_instructions: 'Use the lunch menu.' };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(menu)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ possible_menus: [possibleMenu] })));
    vi.stubGlobal('fetch', fetchMock);
    expect(MENU_API_URL).toBe('http://127.0.0.1:8000/local/menu_image_transcribe');
    expect(MENU_SEARCH_API_URL).toBe('http://127.0.0.1:8000/local/menu_online_search');
    expect(await postMenuImages([new Blob(['jpeg'], { type: 'image/jpeg' })],
      new AbortController().signal)).toEqual(menu);
    expect(await searchMenusOnline('Local Cafe lunch', new AbortController().signal)).toEqual([possibleMenu]);
    expect(fetchMock).toHaveBeenNthCalledWith(1, MENU_API_URL, expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, MENU_SEARCH_API_URL, expect.objectContaining({
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'Local Cafe lunch' }),
    }));
  });
});