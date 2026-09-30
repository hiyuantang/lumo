// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import { describeError, getDataSource } from '../api/source';
import { useAppMenus } from '../shell/appMenus';
import { IconRefresh } from '../shell/icons';
import { useAppPreference } from '../shell/useAppState';

const formats: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon' };
export const imageType = (name: string) => formats[name.split('.').at(-1)?.toLowerCase() ?? ''];

export function ImagePreview({ path, onOpen }: { path: string[]; onOpen: () => void }) {
  const source = getDataSource();
  const name = path.at(-1) ?? 'Image';
  const [revision, setRevision] = useState(0);
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actual, setActual] = useAppPreference<boolean>('preview', 'image-actual', false);
  const [zoom, setZoom] = useState<number | null>(null);
  const pane = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const dragged = useRef(false);
  const [panning, setPanning] = useState(false);
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const fit = size ? Math.min(available.width / size.width, available.height / size.height) : 0;
  const scale = zoom ?? (actual ? 1 : fit);
  const enlarged = actual || zoom !== null;
  const pannable = !!size && (size.width * scale > available.width + 1 || size.height * scale > available.height + 1);
  const selectSize = (value: boolean) => { setZoom(null); setActual(value); };
  const endPan = () => { drag.current = null; setPanning(false); };
  useEffect(() => {
    const node = pane.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setAvailable({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null); setImage(null); setSize(null); setZoom(null);
    void source.readFile(path, 'image').then((read) => {
      if (!alive) return;
      if (read.truncated) throw new Error('This image exceeds the 32 MiB preview limit.');
      if (!read.contentBase64) throw new Error('This image is empty or unavailable.');
      setImage(`data:${imageType(name)};base64,${read.contentBase64}`);
    }).catch((err) => { if (alive) { setError(describeError(err)); setLoading(false); } });
    return () => { alive = false; };
  }, [path, source, name, revision]);
  const refresh = () => setRevision((value) => value + 1);
  useAppMenus({ view: [
    { id: 'refresh', label: 'Refresh', disabled: loading, run: refresh },
    { id: 'image-fit', label: 'Fit to Window', checked: !actual, run: () => selectSize(false) },
    { id: 'image-actual', label: 'Actual Size', checked: actual, run: () => selectSize(true) },
  ] });
  return <div className="app preview" data-testid="app-preview">
    <div className="app-toolbar preview-toolbar"><strong title={name}>{name}</strong><div className="app-toolbar-actions">
      <button type="button" className="btn" disabled={!size} title={enlarged ? 'Fit to window' : 'Show actual size'} data-testid="preview-image-size" onClick={() => selectSize(!enlarged)}>{enlarged ? 'Fit' : '100%'}</button>
      <button type="button" className="btn" data-testid="preview-open" onClick={onOpen}>Open…</button>
      <button type="button" className="btn btn-icon" aria-label="Refresh" title="Refresh" disabled={loading} data-testid="preview-refresh" onClick={refresh}><IconRefresh size={16}/></button>
    </div></div>
    <div ref={pane} className={`preview-image-content${enlarged ? ' preview-image-actual' : ''}${pannable ? ' preview-image-pannable' : ''}${panning ? ' is-panning' : ''}`} data-testid="preview-image-content" tabIndex={0} aria-label="Image preview" aria-busy={loading}
      onPointerDown={(event) => {
        dragged.current = false;
        if (event.button !== 0 || !event.isPrimary || !pannable || loading || error) return;
        const node = event.currentTarget;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: node.scrollLeft, top: node.scrollTop };
        node.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || start.id !== event.pointerId) return;
        const x = event.clientX - start.x; const y = event.clientY - start.y;
        if (!dragged.current && Math.hypot(x, y) < 4) return;
        if (!dragged.current) { dragged.current = true; setPanning(true); }
        event.currentTarget.scrollLeft = start.left - x;
        event.currentTarget.scrollTop = start.top - y;
      }}
      onPointerUp={endPan} onPointerCancel={endPan} onLostPointerCapture={endPan}
      onDoubleClick={() => { if (size && !loading && !error && !dragged.current) setZoom((value) => value === null ? Math.max(1, scale * 2) : null); }}>
      {loading && <p className="preview-image-status" role="status">Loading image…</p>}
      {error ? <p className="preview-image-status preview-error" role="alert">{error}</p> : image && <img key={image + revision} src={image} alt={name} title={zoom !== null ? 'Double-click to zoom out' : 'Double-click to zoom in'} data-testid="preview-image" draggable={false} className={zoom !== null ? 'preview-image-zoomed' : undefined} style={{ visibility: size && scale ? 'visible' : 'hidden', width: size ? size.width * scale : undefined, height: size ? size.height * scale : undefined }} onLoad={(event) => { setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); setLoading(false); }} onError={() => { setError('This image could not be displayed. It may be damaged or use an unsupported format.'); setLoading(false); }}/>}
    </div>
    <footer className="preview-path"><span title={source.absolutePath(path)}>{source.absolutePath(path)}</span>{size && <span data-testid="preview-image-dimensions">{size.width} × {size.height}</span>}</footer>
  </div>;
}
