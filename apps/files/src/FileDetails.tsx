// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { useShell } from '@lumo/sdk/shell/ShellContext';
import type { FsEntry } from '@lumo/sdk/api/source';
import { formatSize } from '@lumo/sdk/utils/file-format';
import { IconFile, IconFolder, IconX } from '@lumo/sdk/shell/icons';

export function FileDetails({ open, entry, path, onClose }: { open: boolean; entry: FsEntry | null; path: string; onClose: () => void }) {
  const { reducedMotion } = useShell();
  const [present, setPresent] = useState(open);
  useEffect(() => {
    if (open) { setPresent(true); return; }
    if (reducedMotion) { setPresent(false); return; }
    const timer = window.setTimeout(() => setPresent(false), 220);
    return () => window.clearTimeout(timer);
  }, [open, reducedMotion]);
  return <div className={`files-details-panel${open ? ' open' : ''}`} data-testid="files-details-panel" aria-hidden={!open} {...(!open ? { inert: '' } : {})}>
    {(open || present) && <aside className="files-details" data-testid="files-details" aria-label="Details">
    <header><h2>Details</h2><button type="button" className="btn" aria-label="Close Details" onClick={onClose}><IconX size={14} /></button></header>
    {entry ? <>
      <div className="files-details-name">{entry.kind === 'dir' ? <IconFolder size={32} /> : <IconFile size={32} />}<strong>{entry.name}</strong></div>
      <dl>
        <dt>Kind</dt><dd>{entry.kind === 'dir' ? 'Folder' : 'File'}</dd>
        <dt>Size</dt><dd>{formatSize(entry.size)}</dd>
        <dt>Modified</dt><dd>{entry.modifiedAt ? new Date(entry.modifiedAt).toLocaleString() : entry.modified}</dd>
        <dt>Path</dt><dd className="mono">{path}</dd>
        {entry.mode && <><dt>Permissions</dt><dd className="mono">{entry.mode}</dd></>}
        {entry.symlinkTarget && <><dt>Link target</dt><dd className="mono">{entry.symlinkTarget}</dd></>}
      </dl>
    </> : <p>Select a file or folder to see its details.</p>}
  </aside>}</div>;
}
