import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MenuSearchPage } from './MenuSearch';
import type { MenuSearchState } from './menuSearchSession';

const menu = { venue_identifier: 'Example Restaurant', menu_identifier: 'Dinner',
  source_url: 'https://example.test/dinner', agent_instructions: 'PRIVATE_EXTRACTION_INSTRUCTIONS' };

function render(state: MenuSearchState, query = '') {
  return renderToStaticMarkup(<MenuSearchPage state={state} query={query}
    onQueryChange={vi.fn()} onSearch={vi.fn()} onBack={vi.fn()} onLoad={vi.fn()} />);
}

describe('unified menu search page', () => {
  it('shows the form and a single Back button without results before the first search', () => {
    const html = render({ status: 'idle' });
    expect(html).toContain('Menu description');
    expect(html).toContain('<form');
    expect(html.match(/>Back<\/button>/g)).toHaveLength(1);
    expect(html).not.toContain('search-results-title');
    expect(html).not.toContain('Clear search term');
    expect(html).toContain('type="submit" disabled=""');
  });

  it('renders completed results below the editable form even when the draft differs', () => {
    const html = render({ status: 'complete', query: 'Original dinner query', menus: [menu] }, 'New lunch draft');
    expect(html).toContain('value="New lunch draft"');
    expect(html).toContain('Found 1 possible matches. Select one to load');
    expect(html).toContain('Example Restaurant');
    expect(html).toContain('Dinner');
    expect(html).toContain('href="https://example.test/dinner"');
    expect(html).not.toContain(menu.agent_instructions);
    expect(html.indexOf('</form>')).toBeLessThan(html.indexOf('id="search-results-title"'));
    expect(html.match(/<main/g)).toHaveLength(1);
    expect(html.match(/>Back<\/button>/g)).toHaveLength(1);
  });

  it('keeps results visible with a cleared input and hides the clear button', () => {
    const html = render({ status: 'complete', query: 'Dinner', menus: [menu] });
    expect(html).toContain('Example Restaurant');
    expect(html).toContain('value=""');
    expect(html).not.toContain('Clear search term');
    expect(html).toContain('type="submit" disabled=""');
  });

  it('places the description, source link, and explicit load button inside a non-clickable card', () => {
    const html = render({ status: 'complete', query: 'Dinner', menus: [menu] });
    const card = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/)?.[1] ?? '';
    expect(card).toContain('<h3 class="search-venue" id="search-match-0">Example Restaurant</h3>');
    expect(card).toContain('<p class="search-menu">Dinner</p>');
    expect(card).toContain('target="_blank" rel="noopener noreferrer"');
    expect(card.indexOf('</p>')).toBeLessThan(card.indexOf('<a '));
    expect(card.indexOf('</a>')).toBeLessThan(card.indexOf('<button '));
    expect(card).toMatch(/<button[^>]*type="button"[^>]*>Load this Menu<\/button>/);
    expect(card.match(/<button\b/g)).toHaveLength(1);
    expect(html).toContain('aria-labelledby="search-match-0"');
  });

  it('gives every result its own load button, including results without source links', () => {
    const html = render({ status: 'complete', query: 'Dinner', menus: [menu, { ...menu, source_url: '' }] });
    expect(html.match(/>Load this Menu<\/button>/g)).toHaveLength(2);
    expect(html.match(/<a\b/g)).toHaveLength(1);
    expect(html).toContain('aria-labelledby="search-match-1"');
    expect(html).not.toContain(menu.agent_instructions);
  });

  it('offers a labeled non-submit clear button for a nonempty draft', () => {
    const html = render({ status: 'idle' }, 'Dinner');
    expect(html).toContain('class="search-clear" type="button" aria-label="Clear search term"');
    expect(html).toContain('<span aria-hidden="true">×</span>');
    expect(html).not.toContain('type="submit" disabled');
  });

  it('keeps the form visible but prevents duplicate submissions while searching', () => {
    const html = render({ status: 'loading', query: 'Dinner' }, 'Dinner');
    expect(html).toContain('<form');
    expect(html).toContain('Searching the web for your menu…');
    expect(html).toContain('role="status"');
    expect(html).toContain('type="submit" disabled=""');
  });

  it('shows no-match guidance on the same page as the search form', () => {
    const html = render({ status: 'complete', query: 'Dinner', menus: [] }, 'Dinner');
    expect(html).toContain('Could not find a menu');
    expect(html).toContain('description above.');
    expect(html).not.toContain('Go back and try');
    expect(html).not.toContain('type="submit" disabled');
  });

  it('shows recoverable errors alongside an enabled search form', () => {
    const html = render({ status: 'error', query: 'Dinner', message: 'Please try again.' }, 'Dinner');
    expect(html).toContain('role="alert">Please try again.');
    expect(html).toContain('<form');
    expect(html).not.toContain('type="submit" disabled');
  });

  it('continues to hide unsafe source links and private instructions', () => {
    const html = render({ status: 'complete', query: 'Dinner',
      menus: [{ ...menu, source_url: 'javascript:alert(1)' }] }, 'Dinner');
    expect(html).toContain('Example Restaurant');
    expect(html).not.toContain('href=');
    expect(html).not.toContain(menu.agent_instructions);
  });
});