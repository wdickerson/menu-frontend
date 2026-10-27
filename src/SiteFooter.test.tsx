import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SiteFooter from './SiteFooter';

describe('site footer', () => {
  it('credits the creator and links to the original profiles and littleapp.io', () => {
    const html = renderToStaticMarkup(<SiteFooter />);
    expect(html).toContain('<footer class="site-footer">');
    expect(html).toContain('Created by William Dickerson');
    expect(html).toContain('href="https://github.com/wdickerson"');
    expect(html).toContain('aria-label="William Dickerson on GitHub"');
    expect(html).toContain('href="https://www.linkedin.com/in/wdickerson08"');
    expect(html).toContain('aria-label="William Dickerson on LinkedIn"');
    expect(html).toContain('<span aria-hidden="true">|</span> <a href="https://littleapp.io">littleapp.io</a>');
  });

  it('renders both Font Awesome icons inline without remote icon assets', () => {
    const html = renderToStaticMarkup(<SiteFooter />);
    expect(html.match(/<svg\b/g)).toHaveLength(2);
    expect(html).toContain('data-icon="github"');
    expect(html).toContain('data-icon="linkedin"');
    const icons = html.match(/<svg\b[^>]*>/g) ?? [];
    for (const icon of icons) {
      expect(icon).toContain('aria-hidden="true"');
      expect(icon).toContain('focusable="false"');
    }
    expect(html).not.toMatch(/<(?:script|link|img)\b/);
  });
});