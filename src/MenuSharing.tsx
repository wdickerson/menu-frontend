import { useEffect, useRef, useState } from 'react';
import type { RestaurantMenu } from './data/menus';
import { createMenuShareSession, type MenuShareState } from './menuShareSession';

export default function MenuSharing({ menu, disabled, onShared }: {
  menu: RestaurantMenu | null;
  disabled: boolean;
  onShared: (snapshot: RestaurantMenu, id: string) => boolean;
}) {
  const [state, setState] = useState<MenuShareState>({ status: 'idle' });
  const [session] = useState(() => createMenuShareSession(setState));
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  const busy = state.status === 'uploading' || state.status === 'sharing';

  useEffect(() => () => session.cancel(), [session]);
  useEffect(() => {
    if (disabled) { session.cancel(); setState({ status: 'idle' }); }
  }, [disabled, session]);
  useEffect(() => { if (state.status === 'error') errorRef.current?.focus(); }, [state]);

  return <>
    <button className="menu-button" type="button" disabled={disabled || !menu || busy}
      onClick={() => {
        if (!menu) return;
        session.start(menu, (id) => onShared(menu, id));
      }}>Share This Menu</button>
    {state.status === 'error' && <p role="alert" ref={errorRef} tabIndex={-1}>{state.message}</p>}
    {state.status === 'copied' && <p role="status">Share link copied to clipboard.</p>}
  </>;
}