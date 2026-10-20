import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MENU_SEARCH_API_URL } from './menuApi';
import { MAX_SEARCH_QUERY_LENGTH, menuSourceUrl, searchMenusOnline, type PossibleMenu } from './menuSearchApi';

const possibleMenu: PossibleMenu = {
  venue_identifier: 'Rough & Tumble Columbia City',
  menu_identifier: 'Dinner menu',
  source_url: 'https://example.test/dinner.pdf',
  agent_instructions: 'Read https://example.test/dinner.pdf for the dinner menu.',
};
const invalidResultsMessage = 'The service returned invalid menu search results. Please try again.';
const fetchMock = vi.fn<typeof fetch>();
const signal = () => new AbortController().signal;
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('online menu search request', () => {
  it('posts only a trimmed JSON query to the search operation with the caller signal', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ possible_menus: [possibleMenu] }));
    const abortSignal = signal();
    const query = 'Café 東京 🍜 "dinner"\nnear the station';
    await searchMenusOnline(` \t${query}\n `, abortSignal);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(MENU_SEARCH_API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }), signal: abortSignal,
    });
  });

  it.each([
    { label: 'one character', query: 'a' },
    { label: '500 ASCII characters', query: 'a'.repeat(500) },
    { label: '500 Unicode code points', query: '🍜'.repeat(500) },
    { label: '500 mixed code points after trimming', query: ` \t${'é🍜'.repeat(250)}\n ` },
  ])('accepts $label', async ({ query }) => {
    expect(MAX_SEARCH_QUERY_LENGTH).toBe(500);
    fetchMock.mockResolvedValue(jsonResponse({ possible_menus: [possibleMenu] }));
    await expect(searchMenusOnline(query, signal())).resolves.toEqual([possibleMenu]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify({ query: query.trim() }));
  });

  it.each([
    { label: 'empty input', query: '' },
    { label: 'only whitespace', query: ' \t\r\n\u00a0\u2003 ' },
    { label: '501 ASCII characters', query: 'a'.repeat(501) },
    { label: '501 Unicode code points', query: '🍜'.repeat(501) },
    { label: '501 characters surrounded by whitespace', query: `  ${'a'.repeat(501)}  ` },
  ])('rejects $label without sending a request', async ({ query }) => {
    await expect(searchMenusOnline(query, signal()))
      .rejects.toEqual(new Error('Describe the menu in 1–500 characters.'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not send a request when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(searchMenusOnline('Dinner menu', controller.signal)).rejects.toBe(controller.signal.reason);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('online menu search results', () => {
  it.each([0, 1, 8, 9, 16])('accepts exactly %i menus and preserves order and every required field', async (count) => {
    const menus = Array.from({ length: count }, (_, index) => ({
      venue_identifier: `Venue ${index + 1}`, menu_identifier: `Menu ${index + 1}`,
      source_url: `https://example.test/${index + 1}.pdf`,
      agent_instructions: `Read https://example.test/${index + 1}.pdf`,
    }));
    fetchMock.mockResolvedValue(jsonResponse({ possible_menus: menus }));
    await expect(searchMenusOnline('Dinner menu', signal())).resolves.toStrictEqual(menus);
  });

  it('trims all returned fields without changing interior whitespace or Unicode', async () => {
    const normalized = { venue_identifier: 'Café 東京 🍜', menu_identifier: 'Dinner  +  drinks',
      source_url: 'https://example.test/Dinner  +  drinks.pdf?name=Café',
      agent_instructions: 'Read https://example.test/menu.pdf\nKeep the original sections.' };
    fetchMock.mockResolvedValue(jsonResponse({ possible_menus: [{
      venue_identifier: `\t ${normalized.venue_identifier}\n`,
      menu_identifier: `\u00a0${normalized.menu_identifier} `,
      source_url: `\n ${normalized.source_url}\t`,
      agent_instructions: `\n${normalized.agent_instructions}\t `,
    }] }));
    await expect(searchMenusOnline('Café dinner', signal())).resolves.toStrictEqual([normalized]);
  });

  it.each([
    { label: 'unknown top-level field', root: { debug: true }, candidate: {} },
    { label: 'extra menu field', root: {}, candidate: { url: 'https://example.test' } },
    { label: 'contradictory and malicious metadata', root: {
      status: 'failed', refusal: 'PRIVATE_METADATA', sources: null, annotations: [],
      error: { code: 'unavailable', message: '<script>PRIVATE_METADATA</script>' },
      unknown: { content: 'PRIVATE_METADATA' },
    }, candidate: {
      status: 'refused', sources: ['javascript:PRIVATE_METADATA'],
      html: '<img src=x onerror="PRIVATE_METADATA">',
    } },
  ])('ignores and strips $label from usable results', async ({ root, candidate }) => {
    fetchMock.mockResolvedValue(jsonResponse({ ...root, possible_menus: [{ ...possibleMenu, ...candidate }] }));
    const result = await searchMenusOnline('Dinner menu', signal());
    expect(result).toStrictEqual([possibleMenu]);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_METADATA');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('accepts two menus with sources null, empty annotations, and no URLs in instructions', async () => {
    const menus = [
      { ...possibleMenu, agent_instructions: 'Find the dinner menu at the venue.' },
      { venue_identifier: 'Café 東京', menu_identifier: 'Brunch', source_url: 'https://example.test/brunch.pdf',
        agent_instructions: 'Find brunch.' },
    ];
    fetchMock.mockResolvedValue(jsonResponse({ sources: null, annotations: [], possible_menus: menus }));
    await expect(searchMenusOnline('Dinner or brunch', signal())).resolves.toStrictEqual(menus);
  });

  const blankFields = (['venue_identifier', 'menu_identifier', 'source_url', 'agent_instructions'] as const).flatMap((field) =>
    ['', ' \t\n\u00a0 ', '\u2003'].map((value) => ({ field, value })));
  it.each(blankFields)('accepts and trims blank $field = $value', async ({ field, value }) => {
    fetchMock.mockResolvedValue(jsonResponse({ possible_menus: [{ ...possibleMenu, [field]: value }] }));
    await expect(searchMenusOnline('Dinner menu', signal())).resolves.toStrictEqual([{ ...possibleMenu, [field]: '' }]);
  });

  it('accepts a menu with all four string fields blank', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ possible_menus: [{
      venue_identifier: ' \t', menu_identifier: '\n', source_url: '\t ', agent_instructions: '',
    }] }));
    await expect(searchMenusOnline('Dinner menu', signal())).resolves.toStrictEqual([{
      venue_identifier: '', menu_identifier: '', source_url: '', agent_instructions: '',
    }]);
  });

  it.each([
    '', ' \t\n', 'not a URL', 'https://', 'https://[bad-host]/menu',
    'javascript:alert(1)', 'data:text/html,private', 'ftp://example.test/menu.pdf',
    'https://user:password@example.test/menu.pdf',
  ])('accepts source_url string %j without a URL validity gate but hides its citation', async (source_url) => {
    fetchMock.mockResolvedValue(jsonResponse({ possible_menus: [{ ...possibleMenu, source_url }] }));
    const results = await searchMenusOnline('Dinner menu', signal());
    expect(results).toStrictEqual([{ ...possibleMenu, source_url: source_url.trim() }]);
    expect(menuSourceUrl(results[0])).toBeNull();
  });

  it.each([
    { label: 'null body', body: null },
    { label: 'string body', body: 'possible_menus' },
    { label: 'number body', body: 1 },
    { label: 'boolean body', body: true },
    { label: 'array body', body: [possibleMenu] },
    { label: 'missing results field', body: {} },
    { label: 'renamed results field', body: { menus: [possibleMenu] } },
    { label: 'null results', body: { possible_menus: null } },
    { label: 'object results', body: { possible_menus: possibleMenu } },
    { label: 'string results', body: { possible_menus: 'menus' } },
    { label: 'boolean results', body: { possible_menus: false } },
    { label: 'number results', body: { possible_menus: 1 } },
    { label: 'null menu', body: { possible_menus: [null] } },
    { label: 'array menu', body: { possible_menus: [[]] } },
    { label: 'primitive menu', body: { possible_menus: ['menu'] } },
    { label: 'empty menu', body: { possible_menus: [{}] } },
    { label: 'one malformed menu among valid results', body: { possible_menus: [possibleMenu, {}] } },
  ])('rejects $label', async ({ body }) => {
    fetchMock.mockResolvedValue(jsonResponse(body));
    await expect(searchMenusOnline('Dinner menu', signal())).rejects.toEqual(new Error(invalidResultsMessage));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  const invalidFields = (['venue_identifier', 'menu_identifier', 'source_url', 'agent_instructions'] as const).flatMap((field) =>
    [undefined, null, 42, false, [], {}].map((value) => ({ field, value })));
  it.each(invalidFields)('rejects missing or non-string $field = $value', async ({ field, value }) => {
    fetchMock.mockResolvedValue(jsonResponse({ possible_menus: [possibleMenu, { ...possibleMenu, [field]: value }] }));
    await expect(searchMenusOnline('Dinner menu', signal())).rejects.toEqual(new Error(invalidResultsMessage));
  });

  it('rejects a substituted required field even when the menu still has four keys', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ possible_menus: [{
      venue_identifier: possibleMenu.venue_identifier, menu_identifier: possibleMenu.menu_identifier,
      source_url: possibleMenu.source_url,
      instructions: possibleMenu.agent_instructions,
    }] }));
    await expect(searchMenusOnline('Dinner menu', signal())).rejects.toEqual(new Error(invalidResultsMessage));
  });

  it.each(['', '<html>Gateway response</html>', '{broken JSON'])('rejects non-JSON HTTP 200 body %j', async (body) => {
    fetchMock.mockResolvedValue(new Response(body));
    await expect(searchMenusOnline('Dinner menu', signal())).rejects.toEqual(new Error(invalidResultsMessage));
  });
});

describe('online menu search errors and cancellation', () => {
  it('also treats HTTP 422 with no_menu_found as no matches', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'no_menu_found', message: 'No matches.' } }, 422));
    await expect(searchMenusOnline('Dinner menu', signal())).resolves.toStrictEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([400, 422, 500, 503, 504])('does not accept usable result JSON on HTTP %i', async (status) => {
    fetchMock.mockResolvedValue(jsonResponse({ possible_menus: [possibleMenu] }, status));
    await expect(searchMenusOnline('Dinner menu', signal())).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([400, 404, 500])('does not convert no_menu_found on HTTP %i into no matches', async (status) => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'no_menu_found' } }, status));
    await expect(searchMenusOnline('Dinner menu', signal()))
      .rejects.toEqual(new Error(`Menus could not be searched (HTTP ${status}). Please try again.`));
  });

  it.each([
    { label: 'missing error', body: {} },
    { label: 'null error', body: { error: null } },
    { label: 'string error', body: { error: 'no_menu_found' } },
    { label: 'missing code', body: { error: { message: 'no_menu_found' } } },
    { label: 'wrong code type', body: { error: { code: 422 } } },
    { label: 'different code', body: { error: { code: 'invalid_query' } } },
  ])('does not convert HTTP 422 with $label into no matches', async ({ body }) => {
    fetchMock.mockResolvedValue(jsonResponse(body, 422));
    await expect(searchMenusOnline('Dinner menu', signal()))
      .rejects.toEqual(new Error('Menus could not be searched (HTTP 422). Please try again.'));
  });

  it('rejects a no_menu_found error envelope returned as HTTP 200', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'no_menu_found' } }));
    await expect(searchMenusOnline('Dinner menu', signal())).rejects.toEqual(new Error(invalidResultsMessage));
  });

  it.each([
    { status: 503, code: 'api_not_configured', message: 'The menu search service is currently unavailable. Please try again later.' },
    { status: 503, code: 'no_menu_found', message: 'The menu search service is currently unavailable. Please try again later.' },
    { status: 504, code: 'provider_timeout', message: 'Searching took too long. Please try again.' },
    { status: 504, code: 'no_menu_found', message: 'Searching took too long. Please try again.' },
    { status: 422, code: 'search_refused', message: 'This search could not be processed. Try a different menu description.' },
    { status: 502, code: 'provider_error', message: 'Menus could not be searched (HTTP 502). Please try again.' },
  ])('returns a safe error for HTTP $status / $code without leaking provider details', async ({ status, code, message }) => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code,
      message: 'PRIVATE_PROVIDER_DETAILS https://private.example.test/internal' } }, status));
    await expect(searchMenusOnline('Dinner menu', signal())).rejects.toEqual(new Error(message));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    { status: 503, message: 'The menu search service is currently unavailable. Please try again later.' },
    { status: 504, message: 'Searching took too long. Please try again.' },
    { status: 502, message: 'Menus could not be searched (HTTP 502). Please try again.' },
    { status: 422, message: 'Menus could not be searched (HTTP 422). Please try again.' },
  ])('handles a non-JSON HTTP $status gateway error safely', async ({ status, message }) => {
    fetchMock.mockResolvedValue(new Response('<html>PRIVATE_PROVIDER_DETAILS</html>', { status }));
    await expect(searchMenusOnline('Dinner menu', signal())).rejects.toEqual(new Error(message));
  });

  it('propagates a network failure without retrying or converting it to no matches', async () => {
    const error = new TypeError('Failed to fetch');
    fetchMock.mockRejectedValue(error);
    await expect(searchMenusOnline('Dinner menu', signal())).rejects.toBe(error);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('propagates in-flight cancellation without retrying', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    }));
    const result = searchMenusOnline('Dinner menu', controller.signal);
    controller.abort();
    await expect(result).rejects.toBe(controller.signal.reason);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([200, 422])('ignores an HTTP %i response parsed after cancellation even if transport ignores abort', async (status) => {
    const controller = new AbortController();
    const response = jsonResponse(status === 200 ? { possible_menus: [possibleMenu] }
      : { error: { code: 'no_menu_found' } }, status);
    let finishBody!: (value: unknown) => void;
    const body = new Promise<unknown>((resolve) => { finishBody = resolve; });
    const parseBody = vi.spyOn(response, 'json').mockReturnValue(body);
    fetchMock.mockResolvedValue(response);
    const result = searchMenusOnline('Dinner menu', controller.signal);
    await Promise.resolve();
    expect(parseBody).toHaveBeenCalledOnce();
    controller.abort();
    finishBody(status === 200 ? { possible_menus: [possibleMenu] } : { error: { code: 'no_menu_found' } });
    await expect(result).rejects.toBe(controller.signal.reason);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});