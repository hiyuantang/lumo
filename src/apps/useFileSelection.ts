// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState, type Dispatch, type SetStateAction, type PointerEvent, type MouseEvent, type KeyboardEvent } from 'react';
import { useAppState } from '../shell/useAppState';

type Box = { left: number; top: number; width: number; height: number };
type Gesture = { node: HTMLElement; id: number; x: number; y: number; startX: number; startY: number; clientX: number; clientY: number; initial: string[]; base: string[]; moved: boolean };

export function useFileSelection(names: string[]) {
  const [selectedNames, setSelectedNames] = useAppState<string[]>('files', 'selection', []);
  return useItemSelection(names, selectedNames, setSelectedNames);
}

export function useItemSelection(names: string[], selectedNames: string[], setSelectedNames: Dispatch<SetStateAction<string[]>>) {
  const [box, setBox] = useState<Box | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef(0);
  const anchor = useRef<string | null>(null);
  const selectOne = (name: string | null) => { anchor.current = name; setSelectedNames(name ? [name] : []); };
  function select(name: string, event: Pick<MouseEvent, 'shiftKey' | 'metaKey' | 'ctrlKey'>) {
    if (event.shiftKey && anchor.current && names.includes(anchor.current)) {
      const a = names.indexOf(anchor.current), b = names.indexOf(name);
      const range = names.slice(Math.min(a, b), Math.max(a, b) + 1);
      setSelectedNames(event.metaKey || event.ctrlKey ? [...new Set([...selectedNames, ...range])] : range);
    } else if (event.metaKey || event.ctrlKey) {
      anchor.current = name;
      setSelectedNames((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
    } else selectOne(name);
  }
  function finish(cancel = false) {
    const current = gesture.current;
    gesture.current = null;
    cancelAnimationFrame(frame.current);
    if (current) {
      if (cancel) setSelectedNames(current.initial);
      if (current.node.hasPointerCapture(current.id)) current.node.releasePointerCapture(current.id);
    }
    setBox(null);
  }
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  function update() {
    const current = gesture.current;
    if (!current || !current.moved) return;
    const scroller = current.node.closest('.files-table-scroll');
    if (scroller) {
      const bounds = scroller.getBoundingClientRect();
      const delta = current.clientY < bounds.top + 24 ? -12 : current.clientY > bounds.bottom - 24 ? 12 : 0;
      scroller.scrollTop += delta;
    }
    const bounds = current.node.getBoundingClientRect();
    const x = Math.max(0, Math.min(current.node.clientWidth, current.clientX - bounds.left));
    const y = Math.max(0, Math.min(current.node.clientHeight, current.clientY - bounds.top));
    const rect = { left: Math.min(current.x, x), top: Math.min(current.y, y), width: Math.abs(x - current.x), height: Math.abs(y - current.y) };
    const matches = [...current.node.querySelectorAll<HTMLElement>('[data-file-row]')].filter((row) => {
      const r = row.getBoundingClientRect();
      return r.right > bounds.left + rect.left && r.left < bounds.left + rect.left + rect.width && r.bottom > bounds.top + rect.top && r.top < bounds.top + rect.top + rect.height;
    }).map((row) => row.dataset.fileRow!);
    setBox((previous) => previous && previous.left === rect.left && previous.top === rect.top && previous.width === rect.width && previous.height === rect.height ? previous : rect);
    const next = [...new Set([...current.base, ...matches])];
    setSelectedNames((previous) => previous.length === next.length && previous.every((name, index) => name === next[index]) ? previous : next);
    frame.current = requestAnimationFrame(update);
  }
  return {
    selectedNames, setSelectedNames, selectOne, select, box,
    bind: {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (event.button !== 0 || event.pointerType === 'touch' || (event.target as HTMLElement).closest('[data-file-row],button')) return;
        event.preventDefault();
        event.currentTarget.focus();
        const bounds = event.currentTarget.getBoundingClientRect();
        const base = event.metaKey || event.ctrlKey || event.shiftKey ? selectedNames : [];
        gesture.current = { node: event.currentTarget, id: event.pointerId, x: event.clientX - bounds.left, y: event.clientY - bounds.top, startX: event.clientX, startY: event.clientY, clientX: event.clientX, clientY: event.clientY, base, initial: selectedNames, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
        setSelectedNames(base);
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        const current = gesture.current;
        if (!current) return;
        const distance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
        current.clientX = event.clientX; current.clientY = event.clientY;
        if (!current.moved && distance >= 3) { current.moved = true; update(); }
      },
      onPointerUp() { finish(); },
      onPointerCancel() { finish(true); },
      onLostPointerCapture() { if (gesture.current) finish(); },
      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); event.stopPropagation(); setSelectedNames(names); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (gesture.current) finish(true); else selectOne(null); }
      },
    },
  };
}
