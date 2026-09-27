// SPDX-License-Identifier: AGPL-3.0-only
import { useLayoutEffect, useRef, useState, type FocusEvent } from 'react';
import type { WindowState } from './ShellContext';
import type { Viewport } from './windowGeometry';

const DURATION = 420;

export function useWindowMinimize(win: WindowState, viewport: Viewport, reducedMotion: boolean) {
  const { id, appId, minimized, x, y, w, h } = win;
  const ref = useRef<HTMLElement>(null);
  const animation = useRef<Animation | null>(null);
  const previous = useRef(minimized);
  const lastFocus = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(!minimized);
  const [motion, setMotion] = useState<'initial' | 'animating' | 'settled'>(minimized ? 'settled' : 'initial');
  const transitioning = motion === 'animating' || visible === minimized;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const changed = previous.current !== minimized;
    previous.current = minimized;
    const app = document.querySelector<HTMLButtonElement>(`[data-testid="dock-app-${appId}"]`);
    const dock = document.querySelector<HTMLButtonElement>(`[data-testid="dock-minimized-${id}"]`) ?? app;
    if (changed && minimized) dock?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

    if (changed && minimized && element.contains(document.activeElement)) {
      const next = document.querySelector<HTMLElement>('.window.focused:not([hidden])');
      (next ?? dock)?.focus({ preventScroll: true });
    }
    element.inert = minimized || Boolean(animation.current);
    if (!changed && !animation.current) return;

    const settle = () => {
      if (animation.current) {
        animation.current.onfinish = null;
        animation.current.cancel();
      }
      animation.current = null;
      element.inert = minimized;
      element.hidden = minimized;
      setVisible(!minimized);
      setMotion('settled');
      if (!minimized && element.classList.contains('focused') &&
        (document.activeElement === dock || document.activeElement === app || document.activeElement === document.body || element.contains(document.activeElement))) {
        const target = lastFocus.current;
        (target?.isConnected && element.contains(target) ? target : element).focus({ preventScroll: true });
        if (!element.contains(document.activeElement)) element.focus({ preventScroll: true });
      }
    };

    if (reducedMotion || !changed) {
      settle();
      return;
    }
    if (animation.current) {
      animation.current.onfinish = settle;
      animation.current.reverse();
      return;
    }

    const icon = dock?.querySelector<HTMLElement>('.dock-window-canvas') ?? dock?.querySelector<HTMLElement>('.dock-icon');
    const bounds = element.getBoundingClientRect();
    const target = icon?.getBoundingClientRect();
    if (!target || !bounds.width || !bounds.height) {
      settle();
      return;
    }
    const dx = target.x + target.width / 2 - bounds.x - bounds.width / 2;
    const dy = target.y + target.height / 2 - bounds.y - bounds.height / 2;
    const scale = Math.min(target.width / bounds.width, target.height / bounds.height);
    const effect = element.animate([
      { transform: 'none', opacity: 1, offset: 0 },
      { transform: `translate(${dx * 0.8}px, ${dy * 0.6}px) scale(0.38)`, opacity: 1, offset: 0.65 },
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 1, offset: 1 },
    ], { duration: DURATION, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'both' });
    animation.current = effect;
    element.inert = true;
    setMotion('animating');
    if (!minimized) {
      effect.currentTime = DURATION;
      effect.reverse();
    }
    effect.onfinish = settle;
  }, [id, appId, minimized, reducedMotion, x, y, w, h, viewport.w, viewport.h]);

  useLayoutEffect(() => () => {
    if (animation.current) {
      animation.current.onfinish = null;
      animation.current.cancel();
    }
    animation.current = null;
  }, []);

  function rememberFocus(event: FocusEvent<HTMLElement>) {
    if (event.target !== event.currentTarget && !event.target.closest('.window-controls')) lastFocus.current = event.target;
  }

  return {
    ref,
    rememberFocus,
    hidden: minimized && !visible && !transitioning,
    hasMinimized: motion !== 'initial' || transitioning,
    phase: transitioning ? (minimized ? 'minimizing' : 'restoring') : (minimized ? 'minimized' : 'visible'),
  };
}
