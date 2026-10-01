// SPDX-License-Identifier: AGPL-3.0-only
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface PiConversationWindow { key: string; project: string; session: string; compact: boolean; show: () => void }
const PiConversationWindows = createContext<{ windows: PiConversationWindow[]; register: (owner: PiConversationWindow) => () => void }>({ windows: [], register: () => () => {} });

export function PiConversationWindowsProvider({ children }: { children: ReactNode }) {
  const [windows, setWindows] = useState<PiConversationWindow[]>([]);
  const register = useCallback((owner: PiConversationWindow) => {
    setWindows((previous) => [...previous.filter((item) => item.key !== owner.key), owner]);
    return () => setWindows((previous) => previous.filter((item) => item !== owner));
  }, []);
  const value = useMemo(() => ({ windows, register }), [windows, register]);
  return <PiConversationWindows.Provider value={value}>{children}</PiConversationWindows.Provider>;
}

export const usePiConversationWindows = () => useContext(PiConversationWindows);

export function PiConversationLocation({ owner, onRetry }: { owner?: PiConversationWindow; onRetry: () => void }) {
  const floating = owner?.compact;
  return <div className="pi-conversation-location" data-testid="pi-conversation-location" role="status">
    <h2>{floating ? 'Open in the floating window' : 'Open in another Pi window'}</h2>
    <p>{floating ? 'Continue this conversation in the floating Pi window.' : 'Continue this conversation in the Pi window where it is already open.'}</p>
    <button type="button" className="btn" data-testid="pi-conversation-show" onClick={owner?.show ?? onRetry}>{owner ? floating ? 'Show floating window' : 'Show Pi window' : 'Try again'}</button>
  </div>;
}
