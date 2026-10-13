import { afterEach, describe, expect, it, vi } from 'vitest';

const deployedUrl = 'https://we8asbpr8l.execute-api.us-east-1.amazonaws.com/prod/menus';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('menu API environment URL', () => {
  it.each([undefined, '', '   '])('falls back to the deployed endpoint for %s', async (value) => {
    vi.stubEnv('VITE_MENU_API_URL', value);
    vi.resetModules();
    expect((await import('./menuApi')).MENU_API_URL).toBe(deployedUrl);
  });

  it('posts to the configured local endpoint, trimming surrounding whitespace', async () => {
    vi.stubEnv('VITE_MENU_API_URL', '  http://127.0.0.1:8000/menus  ');
    vi.resetModules();
    const { MENU_API_URL, postMenuImages } = await import('./menuApi');
    const menu = { restaurantName: 'Local Cafe', sections: [{ name: 'Lunch', items: ['Soup'] }] };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(menu)));
    vi.stubGlobal('fetch', fetchMock);
    expect(MENU_API_URL).toBe('http://127.0.0.1:8000/menus');
    expect(await postMenuImages([new Blob(['jpeg'], { type: 'image/jpeg' })],
      new AbortController().signal)).toEqual(menu);
    expect(fetchMock).toHaveBeenCalledWith(MENU_API_URL, expect.objectContaining({ method: 'POST' }));
  });
});