import { useEffect, useRef, useState } from 'react';
import { MAX_SEARCH_QUERY_LENGTH, menuSourceUrl } from './menuSearchApi';
import type { MenuSearchState } from './menuSearchSession';

export function MenuSearchPage({ query, onQueryChange, onSearch, onBack, focusInput }: {
  query: string;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  onBack: () => void;
  focusInput: boolean;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusInput) inputRef.current?.focus();
    else headingRef.current?.focus();
  }, [focusInput]);

  return <main className="screen" aria-labelledby="search-title">
    <section className="reader-panel selection-panel search-panel">
      <h1 id="search-title" ref={headingRef} tabIndex={-1}>Search the web for a menu</h1>
      <p id="search-instructions" className="selection-note">Describe the menu you are looking for. Be specific (ie, Rough &amp; Tumble Columbia City dinner menu).</p>
      <form className="search-form" onSubmit={(event) => { event.preventDefault(); if (query.trim()) onSearch(); }}>
        <div className="menu-name-field">
          <label htmlFor="menu-query">Menu description</label>
          <input id="menu-query" ref={inputRef} type="text" value={query} required
            maxLength={MAX_SEARCH_QUERY_LENGTH} aria-describedby="search-instructions"
            onChange={(event) => onQueryChange(event.target.value)} />
        </div>
        <button className="menu-button primary-button" type="submit" disabled={!query.trim()}>Search</button>
      </form>
      <button className="menu-button" type="button" onClick={onBack}>Back</button>
    </section>
  </main>;
}

export function MenuSearchResultsPage({ state, onBack }: { state: MenuSearchState; onBack: () => void }) {
  const summaryRef = useRef<HTMLHeadingElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => { summaryRef.current?.focus(); }, [state]);
  const loading = state.status === 'loading';
  const menus = state.status === 'complete' ? state.menus : [];
  const summary = loading ? 'Searching the web for your menu…'
    : state.status === 'complete' ? menus.length ? `Found ${menus.length} possible matches. Select one to load` : 'Could not find a menu'
      : 'Menu search not completed';

  return <main className="screen" aria-labelledby="search-results-title">
    <section className="reader-panel selection-panel search-panel">
      <h1 id="search-results-title" ref={summaryRef} tabIndex={-1}>{summary}</h1>
      {loading && <div role="status">
        <span className="processing-indicator" aria-hidden="true" />
        <p>Looking for matching menus. You can go back to cancel this search.</p>
      </div>}
      {state.status === 'error' && <p role="alert">{state.message}</p>}
      {state.status === 'idle' && <p>Go back to describe the menu you are looking for.</p>}
      {state.status === 'complete' && menus.length === 0 && <p>Go back and try a more specific venue, location, or menu description.</p>}
      {menus.length > 0 && <>
        <div className="restaurant-options" aria-label="Possible menus">
          {menus.map((menu, index) => {
            const sourceUrl = menuSourceUrl(menu);
            return <article className="search-match" key={index}>
              <button className="menu-button search-result-card" type="button"
                aria-pressed={selected === index} onClick={() => setSelected(index)}>
                <span className="search-venue">{menu.venue_identifier}</span>
                <span className="search-menu">{menu.menu_identifier}</span>
              </button>
              {sourceUrl && <a className="search-source" href={sourceUrl} target="_blank" rel="noopener noreferrer"
                aria-label={`Menu source for ${menu.venue_identifier}, ${menu.menu_identifier} (opens in a new tab)`}>
                Menu source (opens in a new tab)
              </a>}
            </article>;
          })}
        </div>
        <p className="selection-note" role="status">{selected !== null
          ? 'Menu selected. Loading online menus will be available in a future version.'
          : 'Online menu loading is not available in this version yet.'}</p>
      </>}
      <button className="menu-button" type="button" onClick={onBack}>Back</button>
    </section>
  </main>;
}