import { describe, expect, it } from 'vitest';
import { menuSourceUrl, type PossibleMenu } from './menuSearchApi';

const menu: PossibleMenu = { venue_identifier: 'Cafe', menu_identifier: 'Dinner menu',
  source_url: 'https://example.com/menu.pdf', agent_instructions: '' };

describe('menu source citations', () => {
  it('uses the explicit source rather than a conflicting URL in private instructions', () => {
    expect(menuSourceUrl({ ...menu, agent_instructions:
      'Private extraction guidance. Read https://other.example.org/private.pdf instead.' }))
      .toBe('https://example.com/menu.pdf');
  });

  it('uses the explicit source when instructions contain no URL', () => {
    expect(menuSourceUrl({ ...menu, agent_instructions: 'Keep the original menu sections.' }))
      .toBe('https://example.com/menu.pdf');
  });

  it.each(['', ' \t\n'])('never falls back to instructions for blank source %j', (source_url) => {
    expect(menuSourceUrl({ ...menu, source_url, agent_instructions: 'Read https://example.org/fallback.pdf' }))
      .toBeNull();
  });

  it.each([
    { source_url: 'http://example.com/menu.pdf', expected: 'http://example.com/menu.pdf' },
    { source_url: 'https://example.com/main menu.pdf', expected: 'https://example.com/main%20menu.pdf' },
    { source_url: 'https://example.com/main%2Bbrunch%20menu.pdf?v=2&lang=en',
      expected: 'https://example.com/main%2Bbrunch%20menu.pdf?v=2&lang=en' },
    { source_url: 'https://example.com/menu.pdf?name=Dinner menu&next=%2Fbrunch#page=2',
      expected: 'https://example.com/menu.pdf?name=Dinner%20menu&next=%2Fbrunch#page=2' },
    { source_url: 'https://example.com/menu_(dinner).pdf?special=a,b;c!#section(2)',
      expected: 'https://example.com/menu_(dinner).pdf?special=a,b;c!#section(2)' },
    { source_url: 'https://example.com/menu.pdf,', expected: 'https://example.com/menu.pdf,' },
    { source_url: 'https://example.com/menu.pdf.', expected: 'https://example.com/menu.pdf.' },
    { source_url: ' HTTPS://EXAMPLE.COM:443/menu.pdf ', expected: 'https://example.com/menu.pdf' },
  ])('serializes the complete URL without regex truncation: $source_url', ({ source_url, expected }) => {
    expect(menuSourceUrl({ ...menu, source_url })).toBe(expected);
  });

  it.each(['No URL', '/relative/menu.pdf', '//example.com/menu.pdf',
    'javascript:alert(1)', 'data:text/html,private', 'ftp://example.com/menu.pdf', 'https://',
    'http://?menu=1', 'https://exa mple.com/menu.pdf',
    'https://user:password@example.com/menu.pdf', 'https://user@example.com/menu.pdf',
    'https://:password@example.com/menu.pdf', 'https://[bad-host]/menu'])
    ('hides unsafe or invalid source without falling back to private instructions: %s', (source_url) => {
      expect(menuSourceUrl({ ...menu, source_url,
        agent_instructions: 'Private guidance: read https://example.org/fallback.pdf' })).toBeNull();
    });
});