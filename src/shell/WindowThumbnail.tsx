// SPDX-License-Identifier: AGPL-3.0-only
import { useLayoutEffect, useRef } from 'react';
import type { WindowState } from './ShellContext';

const snapshots = new WeakMap<HTMLElement, ShadowRoot>();

function copyWindow(source: HTMLElement, host: HTMLElement) {
  const hidden = source.hidden;
  source.hidden = false;
  try {
    const width = source.offsetWidth;
    const height = source.offsetHeight;
    const copy = source.cloneNode(true) as HTMLElement;
    const originals = [source, ...source.querySelectorAll<HTMLElement>('*')];
    const copies = [copy, ...copy.querySelectorAll<HTMLElement>('*')];
    const scroll: Array<[HTMLElement, number, number]> = [];
    originals.forEach((element, index) => {
      const clone = copies[index];
      clone.removeAttribute('id');
      clone.removeAttribute('data-testid');
      clone.removeAttribute('autofocus');
      clone.removeAttribute('tabindex');
      if (element instanceof HTMLInputElement && clone instanceof HTMLInputElement) {
        clone.value = element.type === 'password' ? '' : element.value;
        clone.checked = element.checked;
      } else if (element instanceof HTMLTextAreaElement && clone instanceof HTMLTextAreaElement) {
        clone.value = element.value;
      } else if (element instanceof HTMLCanvasElement && clone instanceof HTMLCanvasElement) {
        if (element.width && element.height) clone.getContext('2d')?.drawImage(element, 0, 0);
      }
      if (element.scrollTop || element.scrollLeft) scroll.push([clone, element.scrollLeft, element.scrollTop]);
    });
    copy.querySelectorAll('script, iframe, object, embed').forEach((node) => node.remove());
    copy.hidden = false;
    copy.inert = true;
    copy.setAttribute('aria-hidden', 'true');
    const computed = getComputedStyle(source);
    const style = document.createElement('style');
    style.textContent = Array.from(document.styleSheets).map((sheet) => {
      try { return Array.from(sheet.cssRules).map((rule) => rule.cssText).join('\n'); } catch { return ''; }
    }).join('\n') + '\n*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }';
    copy.style.cssText = `position:absolute!important;left:0!important;top:0!important;width:${width}px!important;height:${height}px!important;min-width:0!important;max-width:none!important;max-height:none!important;margin:0!important;opacity:1!important;visibility:visible!important;transform-origin:top left!important;animation:none!important;box-shadow:none!important;font:${computed.font};color:${computed.color};`;
    const shadow = snapshots.get(host) ?? host.attachShadow({ mode: 'closed' });
    snapshots.set(host, shadow);
    shadow.replaceChildren(style, copy);
    const fit = () => {
      const bounds = host.parentElement!;
      const scale = Math.min(bounds.clientWidth / width, bounds.clientHeight / height);
      host.style.width = `${width * scale}px`;
      host.style.height = `${height * scale}px`;
      copy.style.setProperty('transform', `scale(${scale})`, 'important');
    };
    fit();
    scroll.forEach(([element, left, top]) => { element.scrollLeft = left; element.scrollTop = top; });
    return fit;
  } finally {
    source.hidden = hidden;
  }
}

export function WindowThumbnail({ win }: { win: WindowState }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    const source = document.querySelector<HTMLElement>(`[data-testid="window-${win.id}"]`);
    if (!host || !source || !win.minimized) return;
    let fit = copyWindow(source, host);
    const resize = new ResizeObserver(() => fit?.());
    resize.observe(host.parentElement!);
    let timer: number | undefined;
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { observer.disconnect(); fit = copyWindow(source, host); observer.observe(source, { childList: true, subtree: true, characterData: true }); }, 120);
    });
    observer.observe(source, { childList: true, subtree: true, characterData: true });
    return () => { resize.disconnect(); observer.disconnect(); window.clearTimeout(timer); };
  }, [win.id, win.minimized]);
  return <span ref={ref} className="dock-window-snapshot" data-window-thumbnail aria-hidden="true" />;
}
