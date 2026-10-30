// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MenuPage } from './App';
import type { RestaurantMenu } from './data/menus';

function render(menu: RestaurantMenu | null) {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(<MenuPage menu={menu} menuLocalId="test"
    onShared={() => true} onCaptureMenu={() => {}} onSearchMenu={() => {}}
    onSelectRestaurant={() => {}} onEnterQuickNav={() => {}} focusTarget={null}
    storageWarning="" processing={false} processingError="" processingKind={null}
    onRetryProcessing={() => {}} onCancelProcessing={() => {}} onDismissProcessingError={() => {}} />);
  return container;
}

describe('home menu item accessibility', () => {
  it('shows decorative bullets without native list markers or list-item roles', () => {
    const items = ['Soup — $8', 'Salad with seasonal greens — $12'];
    const container = render({ restaurantName: 'Test Cafe', sections: [{ name: 'Lunch', items }] });
    const section = container.querySelector('.menu-section')!;
    expect(section.querySelector('h3')?.textContent).toBe('Lunch');
    expect(section.getAttribute('aria-labelledby')).toBe(section.querySelector('h3')?.id);
    expect(section.querySelectorAll('ul, ol, li, [role="list"], [role="listitem"]')).toHaveLength(0);
    const rows = [...section.querySelectorAll('.menu-item')];
    expect(rows).toHaveLength(items.length);
    rows.forEach((row, index) => {
      expect(row.tagName).toBe('P');
      const bullet = row.querySelector('.menu-item-bullet')!;
      expect(bullet.textContent).toBe('•');
      expect(bullet.getAttribute('aria-hidden')).toBe('true');
      const text = row.lastElementChild!;
      expect(text.textContent).toBe(items[index]);
      expect(text.closest('[aria-hidden="true"]')).toBeNull();
      expect(row.hasAttribute('aria-label')).toBe(false);
    });
  });

  it('preserves blank headings, empty sections, and literal item text', () => {
    const text = '<Soup> & "salad"';
    const container = render({ restaurantName: 'Test Cafe', sections: [
      { name: '', items: [] }, { name: 'Specials', items: [text] },
    ] });
    const sections = container.querySelectorAll('.menu-section');
    expect(sections).toHaveLength(2);
    expect(sections[0].querySelector('h3')?.textContent).toBe('');
    expect(sections[0].querySelector('.menu-items')?.children).toHaveLength(0);
    expect(sections[1].querySelector('.menu-item')?.lastElementChild?.textContent).toBe(text);
    expect(sections[1].querySelector('soup')).toBeNull();
  });

  it('does not render item rows or bullets when no menu is loaded', () => {
    const container = render(null);
    expect(container.querySelectorAll('.menu-section, .menu-item, .menu-item-bullet')).toHaveLength(0);
    expect(container.querySelector('.menu-empty-message')).not.toBeNull();
  });
});