// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { PiModel } from '../api/pi';
import { Popup } from '../shell/Popup';
import { IconChevronDown, IconChevronRight } from '../shell/icons';

const label = (level: string) => level === 'xhigh' ? 'Extra high' : level ? level[0].toUpperCase() + level.slice(1) : 'Off';
const modelKey = (model: PiModel) => `${model.provider}/${model.id}`;

export function PiModelControl({ model, models, levels, level, disabled, onModel, onLevel }: {
  model?: PiModel; models: PiModel[]; levels: string[]; level?: string; disabled: boolean;
  onModel: (model: PiModel) => Promise<boolean | undefined>; onLevel: (level: string) => Promise<boolean | undefined>;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const slider = useRef<HTMLInputElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const restoreSlider = useRef(false);
  const available = levels.length ? levels : ['off'];
  const current = level && available.includes(level) ? level : available[0];
  const selected = preview && available.includes(preview) ? preview : current;
  const index = available.indexOf(selected);
  const progress = available.length > 1 ? index / (available.length - 1) * 100 : 0;
  const unavailable = disabled || saving;
  useEffect(() => {
    if (!unavailable && restoreSlider.current) {
      restoreSlider.current = false;
      if (document.activeElement === document.body) slider.current?.focus({ preventScroll: true });
    }
  }, [unavailable]);
  function close(restore = false) { setAnchor(null); setPreview(null); if (restore) trigger.current?.focus(); }
  function open() { setChoosing(false); setPreview(null); setAnchor(trigger.current!.getBoundingClientRect()); }
  async function changeLevel(value: string) {
    if (unavailable || lock.current) return;
    if (value === current) { setPreview(null); return; }
    restoreSlider.current = document.activeElement === slider.current;
    lock.current = true; setSaving(true);
    try { await onLevel(value); } finally { lock.current = false; setSaving(false); setPreview(null); }
  }
  async function changeModel(value: PiModel) {
    if (unavailable || lock.current) return;
    lock.current = true; setSaving(true);
    try { if (await onModel(value)) { setPreview(null); setChoosing(false); } }
    finally { lock.current = false; setSaving(false); }
  }
  return <>
    <button ref={trigger} type="button" className="pi-model-trigger" data-saving={saving || undefined} data-testid="pi-model" disabled={unavailable || !models.length} aria-haspopup="dialog" aria-expanded={Boolean(anchor)} aria-controls={anchor ? id : undefined} onClick={() => anchor ? close() : open()}>
      <span className="pi-model-name">{model?.name || model?.id || (disabled ? 'Loading models…' : 'No models')}</span><span className="pi-model-effort">{model ? label(current) : ''}</span><IconChevronDown size={14}/>
    </button>
    {anchor && <Popup keyboard={keyboard} key={String(choosing)} x={anchor.left + anchor.width / 2} y={anchor.top - 10} width={248} placement="above" anchorElement={trigger.current} onClose={() => close()}>
      <div id={id} className="pi-model-card" role="dialog" aria-label="Model and effort" aria-busy={saving} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (choosing) setChoosing(false); else close(true); }
        if (event.key === 'Tab') {
          event.stopPropagation();
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'));
          const next = controls.indexOf(document.activeElement as HTMLElement) + (event.shiftKey ? -1 : 1);
          if (next < 0 || next >= controls.length) { event.preventDefault(); close(true); }
        }
      }}>
        {choosing ? <>
          <header className="pi-model-card-heading"><button type="button" className="pi-model-back" aria-label="Back to effort" onClick={() => setChoosing(false)}><IconChevronRight size={16}/></button><strong>Model</strong></header>
          <div className="pi-model-options" role="listbox" aria-label="Models" onKeyDown={(event) => {
            const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
            const active = options.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === 'ArrowDown' ? Math.min(active + 1, options.length - 1) : event.key === 'ArrowUp' ? Math.max(active - 1, 0) : event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : -1;
            if (next >= 0) { event.preventDefault(); options[next]?.focus(); }
          }}>
            {models.map((item) => <button className="popup-item" key={modelKey(item)} type="button" role="option" aria-label={`${item.name || item.id} · ${item.provider}`} aria-selected={Boolean(model && modelKey(item) === modelKey(model))} data-autofocus={Boolean(model && modelKey(item) === modelKey(model)) || undefined} disabled={unavailable} onClick={() => void changeModel(item)}><strong>{item.name || item.id}</strong><small>{item.provider}</small><span className="pi-model-check" aria-hidden="true">{model && modelKey(item) === modelKey(model) ? '✓' : ''}</span></button>)}
          </div>
        </> : <>
          <header className="pi-model-card-heading"><span className="pi-effort-value" aria-live="polite">{label(selected)}</span></header>
          <button className="pi-model-choice" type="button" aria-label="Choose model" disabled={unavailable} onClick={(event) => { setKeyboard(event.detail === 0); setChoosing(true); }}><span>{model?.name || model?.id || 'Choose model'}</span></button>
          <div className={`pi-effort-slider${available.length < 2 ? ' is-fixed' : ''}`} style={{ '--pi-effort-progress': `${progress}%`, '--pi-effort-offset': `${17 - progress * .34}px` } as CSSProperties}>
            <div className="pi-effort-track" aria-hidden="true"><span/><div className="pi-effort-stops">{available.map((value, stop) => <i key={value} className={stop <= index ? 'is-filled' : ''} style={{ left: `${available.length > 1 ? stop / (available.length - 1) * 100 : 0}%` }}/>)}</div></div>
            <input ref={slider} type="range" data-autofocus aria-label="Effort" aria-valuetext={label(selected)} min={0} max={Math.max(1, available.length - 1)} step={1} value={index} disabled={unavailable || available.length < 2} onChange={(event) => setPreview(available[Number(event.target.value)])} onPointerUp={(event) => void changeLevel(available[Number(event.currentTarget.value)])} onPointerCancel={() => setPreview(null)} onKeyUp={(event) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) void changeLevel(available[Number(event.currentTarget.value)]); }} onBlur={(event) => { if (preview) void changeLevel(available[Number(event.currentTarget.value)]); }}/>
          </div>
        </>}
      </div>
    </Popup>}
  </>;
}
