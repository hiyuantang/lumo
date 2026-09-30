// SPDX-License-Identifier: AGPL-3.0-only
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { getDataSource } from '../api/source';
import { useShell } from '../shell/ShellContext';
import { imageType } from './ImagePreview';

export const PiImageScope = createContext('');
export function PiImage({ path, data, mimeType, alt = 'Image', thumbnail = false }: { path?: string; data?: string; mimeType?: string; alt?: string; thumbnail?: boolean }) {
  const { actions } = useShell();
  const project = useContext(PiImageScope);
  const source = getDataSource();
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState<string>();
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const absolute = path?.startsWith('/') ? path : path?.startsWith('~/') ? `${source.absolutePath(source.homePath())}/${path.slice(2)}` : path && project ? `${project}/${path}` : undefined;
  const format = path ? imageType(path) : mimeType;
  const safe = format && /^image\/(png|jpeg|gif|webp|avif|bmp|x-icon)$/.test(format);
  const embedded = safe && data && data.length <= 44 * 1024 * 1024 && /^[A-Za-z0-9+/=\r\n]+$/.test(data) ? `data:${format};base64,${data}` : undefined;
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } });
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !absolute || !safe || embedded) return;
    let disposed = false; setLoaded(undefined); setError(false);
    void source.readSystemFile(absolute, 'image').then((file) => {
      if (disposed) return;
      if (file.truncated || !file.contentBase64) throw new Error('Image unavailable');
      setLoaded(`data:${format};base64,${file.contentBase64}`);
    }).catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; };
  }, [visible, absolute, safe, embedded, format, source]);
  const url = embedded || loaded;
  return <span ref={host} className={`pi-image${thumbnail ? ' is-thumbnail' : ''}${expanded ? ' is-expanded' : ''}`} data-testid="pi-image">
    {url && !error ? <button type="button" className="pi-image-open" aria-label={`${thumbnail ? 'Open' : expanded ? 'Shrink' : 'Enlarge'} ${alt}`} onClick={() => { if (thumbnail && absolute) actions.openPreview(absolute.split('/')); else setExpanded(!expanded); }}><img src={url} alt={alt} loading="lazy" onError={() => setError(true)}/></button> : <span className="pi-image-placeholder">{error || !safe || (!absolute && !embedded) ? 'Image unavailable' : 'Loading image…'}</span>}
  </span>;
}

export function piMarkdownImage(path: string, alt: string) {
  if (/^https?:\/\//i.test(path)) return <a href={path} target="_blank" rel="noopener noreferrer">Image: {alt}</a>;
  const embedded = /^data:(image\/[a-z+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(path);
  if (embedded) return <PiImage data={embedded[2]} mimeType={embedded[1]} alt={alt}/>;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return <span>Image unavailable: {alt}</span>;
  return <PiImage path={path} alt={alt}/>;
}
