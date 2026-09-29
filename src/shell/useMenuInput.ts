// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import '../styles/popup.css';

export function useMenuInput(keyboard = false) {
  const [input, setInput] = useState<'pointer' | 'keyboard'>(keyboard ? 'keyboard' : 'pointer');
  return {
    'data-menu-input': input,
    onPointerMoveCapture: () => setInput('pointer'),
    onPointerDownCapture: () => setInput('pointer'),
    onKeyDownCapture: () => setInput('keyboard'),
  };
}
