import { useEffect, useRef } from 'react';
import { MAX_SEARCH_QUERY_LENGTH, menuSourceUrl, type PossibleMenu } from './menuSearchApi';
import type { MenuSearchState } from './menuSearchSession';

export function MenuSearchPage({ query, state, onQueryChange, onSearch, onBack, onLoad }: {
  query: string;
  state: MenuSearchState;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  onBack: () => void;
  onLoad: (query: string, menu: PossibleMenu) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  const loading = state.status === 'loading';

  return <main className="screen" aria-labelledby="search-title">
    <section className="reader-panel selection-panel search-panel">
      <h1 id="search-title" ref={headingRef} tabIndex={-1}>Search the web for a menu</h1>
      <p id="search-instructions" className="selection-note">Describe the menu you are looking for. Be specific (ie, Rough &amp; Tumble Columbia City dinner menu).</p>
      <form className="search-form" onSubmit={(event) => { event.preventDefault(); if (query.trim() && !loading) onSearch(); }}>
        <div className="menu-name-field">
          <label htmlFor="menu-query">Menu description</label>
          <div className="search-query-control">
            <input id="menu-query" ref={inputRef} type="text" value={query} required
              maxLength={MAX_SEARCH_QUERY_LENGTH} aria-describedby="search-instructions"
              onChange={(event) => onQueryChange(event.target.value)} />
            {query.length > 0 && <button className="search-clear" type="button" aria-label="Clear search term"
              onClick={() => { onQueryChange(''); inputRef.current?.focus(); }}>
              <span aria-hidden="true">×</span>
            </button>}
          </div>
        </div>
        <button className="menu-button primary-button" type="submit" disabled={!query.trim() || loading}>Search</button>
      </form>
      <MenuSearchResults state={state} onLoad={onLoad} />
      <button className="menu-button" type="button" onClick={onBack}>Back</button>
    </section>
  </main>;
}

function MenuSearchResults({ state, onLoad }: {
  state: MenuSearchState;
  onLoad: (query: string, menu: PossibleMenu) => void;
}) {
  const summaryRef = useRef<HTMLHeadingElement>(null);
  const previousStateRef = useRef(state);
  useEffect(() => {
    // Announce new results, but do not steal focus when editing the draft or
    // returning to a page whose results have already been read.
    if (previousStateRef.current !== state) summaryRef.current?.focus();
    previousStateRef.current = state;
  }, [state]);
  if (state.status === 'idle') return null;
  const loading = state.status === 'loading';
  const menus = state.status === 'complete' ? state.menus : [];
  const summary = loading ? 'Searching the web for your menu…'
    : state.status === 'complete' ? menus.length ? `Found ${menus.length} possible matches. Select one to load` : 'Could not find a menu'
      : 'Menu search not completed';

  return <section className="search-results" aria-labelledby="search-results-title">
    <h2 id="search-results-title" ref={summaryRef} tabIndex={-1}>{summary}</h2>
    {loading && <div role="status">
      <span className="processing-indicator" aria-hidden="true" />
      <p>Looking for matching menus. You can go back to cancel this search.</p>
    </div>}
    {state.status === 'error' && <p role="alert">{state.message}</p>}
    {state.status === 'complete' && menus.length === 0 && <p>Try a more specific venue, location, or menu description above.</p>}
    {menus.length > 0 && <div className="restaurant-options" aria-label="Possible menus">
      {menus.map((menu, index) => {
        const sourceUrl = menuSourceUrl(menu);
        return <article className="search-match" key={index}>
          <button className="menu-button search-result-card" type="button"
            onClick={() => { if (state.status === 'complete') onLoad(state.query, menu); }}>
            <span className="search-venue">{menu.venue_identifier}</span>
            <span className="search-menu">{menu.menu_identifier}</span>
          </button>
          {sourceUrl && <a className="search-source" href={sourceUrl} target="_blank" rel="noopener noreferrer"
            aria-label={`Menu source for ${menu.venue_identifier}, ${menu.menu_identifier} (opens in a new tab)`}>
            Menu source (opens in a new tab)
          </a>}
        </article>;
      })}
    </div>}
  </section>;
}