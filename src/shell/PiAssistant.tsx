// SPDX-License-Identifier: AGPL-3.0-only
import { lazy, Suspense, useCallback, useRef } from 'react';
import type { PiAssistantRequest } from '../apps/Pi';
const Pi = lazy(() => import('../apps/Pi').then((module) => ({ default: module.Pi })));
import { WindowContext } from './WindowContext';
import { PiAssistantFrame } from './PiAssistantFrame';

export function PiAssistant({ open, onOpen, onHide, request }: { open: boolean; onOpen: () => void; onHide: () => void; request?: PiAssistantRequest }) {
  const attention = useRef(onOpen); attention.current = onOpen;
  const onAttention = useCallback(() => attention.current(), []);
  return <PiAssistantFrame open={open} focusKey={request?.action === 'new' ? request.id : undefined} onHide={() => { onHide(); document.querySelector<HTMLButtonElement>('[data-testid="pi-tray-button"]')?.focus(); }}>
    {(rect) => <WindowContext.Provider value={{ ...rect, id: 'pi:assistant', appId: 'pi', z: 3900, minimized: false, maximized: false, snapped: null, restore: null }}><Suspense fallback={<div role="status">Opening Pi…</div>}><Pi compact onAttention={onAttention} assistantRequest={request}/></Suspense></WindowContext.Provider>}
  </PiAssistantFrame>;
}
