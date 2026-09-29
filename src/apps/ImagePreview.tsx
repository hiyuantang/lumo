// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { describeError, getDataSource } from '../api/source';
import { useAppMenus } from '../shell/appMenus';
import { IconRefresh } from '../shell/icons';

const formats: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon' };
export const imageType = (name: string) => formats[name.split('.').at(-1)?.toLowerCase() ?? ''];

export function ImagePreview({ path, onOpen }: { path: string[]; onOpen: () => void }) {
  const source = getDataSource();
  const name = path.at(-1) ?? 'Image';
  const [revision, setRevision] = useState(0);
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actual, setActual] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null); setImage(null); setSize(null);
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
    { id: 'image-fit', label: 'Fit to Window', checked: !actual, run: () => setActual(false) },
    { id: 'image-actual', label: 'Actual Size', checked: actual, run: () => setActual(true) },
  ] });
  return <div className="app preview" data-testid="app-preview">
    <div className="app-toolbar preview-toolbar"><strong title={name}>{name}</strong><div className="app-toolbar-actions">
      <button type="button" className="btn" disabled={!size} title={actual ? 'Fit to window' : 'Show actual size'} data-testid="preview-image-size" onClick={() => setActual(!actual)}>{actual ? 'Fit' : '100%'}</button>
      <button type="button" className="btn" data-testid="preview-open" onClick={onOpen}>Open…</button>
      <button type="button" className="btn btn-icon" aria-label="Refresh" title="Refresh" disabled={loading} data-testid="preview-refresh" onClick={refresh}><IconRefresh size={16}/></button>
    </div></div>
    <div className={`preview-image-content${actual ? ' preview-image-actual' : ''}`} data-testid="preview-image-content" tabIndex={0} aria-label="Image preview" aria-busy={loading}>
      {loading && <p className="preview-image-status" role="status">Loading image…</p>}
      {error ? <p className="preview-image-status preview-error" role="alert">{error}</p> : image && <img key={image + revision} src={image} alt={name} data-testid="preview-image" draggable={false} style={{ visibility: size ? 'visible' : 'hidden' }} onLoad={(event) => { setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); setLoading(false); }} onError={() => { setError('This image could not be displayed. It may be damaged or use an unsupported format.'); setLoading(false); }}/>}
    </div>
    <footer className="preview-path"><span title={source.absolutePath(path)}>{source.absolutePath(path)}</span>{size && <span data-testid="preview-image-dimensions">{size.width} × {size.height}</span>}</footer>
  </div>;
}
