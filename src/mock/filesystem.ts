// SPDX-License-Identifier: AGPL-3.0-only
import { formatModified } from '../utils/file-format';
import type { TrashItem, TrashSelection } from '../api/trash';
import type { FsEntry } from '../api/source';
import { ApiError } from '../api/transport';

const HOME: FsEntry = {
  name: 'user',
  kind: 'dir',
  size: 4096,
  modified: 'Jul 12 09:14',
  children: [
    {
      name: 'Documents',
      kind: 'dir',
      size: 4096,
      modified: 'Jul 16 18:02',
      children: [
        {
          name: 'server-notes.md',
          kind: 'file',
          size: 1284,
          modified: 'Jul 16 18:02',
          content:
            '# Atlas server notes\n\n- Host: atlas.lan (192.168.1.20)\n- Backups run nightly at 02:30 via lumo-backup.service\n- PostgreSQL data lives on /srv/postgres\n- Renew TLS certificates before Sep 4\n',
        },
        {
          name: 'upgrade-plan.txt',
          kind: 'file',
          size: 642,
          modified: 'Jul 10 11:47',
          content:
            'Upgrade plan\n============\n1. Snapshot the VM\n2. apt update && apt upgrade\n3. Reboot into the new kernel\n4. Verify nginx, postgresql and fail2ban are active\n',
        },
        { name: 'invoice-june.pdf', kind: 'file', size: 182_044, modified: 'Jul 02 08:15' },
      ],
    },
    {
      name: 'Pictures',
      kind: 'dir',
      size: 4096,
      modified: 'Jun 28 21:33',
      children: [
        { name: 'rack-photo.jpg', kind: 'file', size: 2_418_330, modified: 'Jun 28 21:33' },
        { name: 'network-map.png', kind: 'file', size: 812_410, modified: 'Jun 20 14:05' },
      ],
    },
    {
      name: 'projects',
      kind: 'dir',
      size: 4096,
      modified: 'Jul 17 22:41',
      children: [
        {
          name: 'lumo-agent',
          kind: 'dir',
          size: 4096,
          modified: 'Jul 17 22:41',
          children: [
            {
              name: 'README.md',
              kind: 'file',
              size: 930,
              modified: 'Jul 17 22:41',
              content:
                '# lumo-agent\n\nSmall node agent that reports host metrics to the Lumo broker.\n\nRun with: systemctl start lumo-agent.service\n',
            },
            {
              name: 'agent.ts',
              kind: 'file',
              size: 5210,
              modified: 'Jul 17 22:40',
              content:
                'export async function collectMetrics() {\n  const load = await readLoadavg();\n  const mem = await readMeminfo();\n  return { load, mem, at: new Date().toISOString() };\n}\n',
            },
            { name: 'agent.test.ts', kind: 'file', size: 3120, modified: 'Jul 15 09:12' },
          ],
        },
        {
          name: 'deploy.sh',
          kind: 'file',
          size: 812,
          modified: 'Jul 14 16:20',
          content:
            '#!/bin/sh\nset -eu\nrsync -az --delete dist/ atlas.lan:/srv/www/lumo/\nssh atlas.lan systemctl reload nginx.service\n',
        },
      ],
    },
    {
      name: 'backups',
      kind: 'dir',
      size: 4096,
      modified: 'Jul 18 02:30',
      children: [
        { name: 'postgres-2026-07-18.dump', kind: 'file', size: 96_304_112, modified: 'Jul 18 02:30' },
        { name: 'postgres-2026-07-17.dump', kind: 'file', size: 95_881_204, modified: 'Jul 17 02:30' },
      ],
    },
    {
      name: '.bashrc',
      kind: 'file',
      size: 3771,
      modified: 'May 30 10:02',
      content: "export EDITOR=vim\nalias ll='ls -alF'\nalias gs='git status'\n",
    },
    {
      name: 'notes.txt',
      kind: 'file',
      size: 218,
      modified: 'Jul 11 19:26',
      content: 'Remember to rotate the off-site backup key and tidy /var/log before the end of the month.\n',
    },
  ],
};

export function homePath(): string[] {
  return ['user'];
}

export function getEntry(path: string[]): FsEntry | undefined {
  if (path.length === 0 || path[0] !== HOME.name) return undefined;
  let node: FsEntry = HOME;
  for (const segment of path.slice(1)) {
    const next = node.children?.find((c) => c.name === segment);
    if (!next) return undefined;
    node = next;
  }
  return node;
}

export function listDir(path: string[]): FsEntry[] {
  const node = getEntry(path);
  if (!node || node.kind !== 'dir') return [];
  return [...(node.children ?? [])].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

const revisions = new Map<string, string>();
let revisionCounter = 0;

function pathKey(path: string[]): string {
  return path.join('/');
}

export function entryRevision(path: string[]): string | null {
  const node = getEntry(path);
  if (!node || node.kind !== 'file') return null;
  const key = pathKey(path);
  let revision = revisions.get(key);
  if (!revision) {
    revision = `mock-${++revisionCounter}`;
    revisions.set(key, revision);
  }
  return revision;
}

export function writeEntry(
  path: string[],
  content: string,
  expectedRevision: string | null,
): { revision: string; sizeBytes: number } {
  const name = path[path.length - 1];
  const parent = getEntry(path.slice(0, -1));
  if (!name || !parent || parent.kind !== 'dir') {
    throw new ApiError('not_found', 'The parent folder does not exist.');
  }
  const existing = parent.children?.find((c) => c.name === name);
  if (existing?.kind === 'dir') {
    throw new ApiError('validation_failed', 'Cannot overwrite a folder.');
  }
  if (existing && expectedRevision !== null) {
    const actualRevision = entryRevision(path);
    if (actualRevision !== expectedRevision) {
      throw new ApiError('stale_revision', 'The file changed on disk since it was read.', {
        expectedRevision,
        actualRevision,
      });
    }
  }
  const sizeBytes = new TextEncoder().encode(content).length;
  const modified = formatModified(new Date());
  if (existing) {
    existing.content = content;
    existing.size = sizeBytes;
    existing.modified = modified;
  } else {
    parent.children?.push({ name, kind: 'file', size: sizeBytes, modified, content });
  }
  const revision = `mock-${++revisionCounter}`;
  revisions.set(pathKey(path), revision);
  return { revision, sizeBytes };
}

export function deleteEntry(path: string[]): void {
  const parent = getEntry(path.slice(0, -1));
  const name = path[path.length - 1];
  const index = parent?.children?.findIndex((c) => c.name === name) ?? -1;
  const node = index >= 0 ? parent?.children?.[index] : undefined;
  if (!parent || parent.kind !== 'dir' || !node) {
    throw new ApiError('not_found', 'No such file.');
  }
  const id = crypto.randomUUID();
  trashed.set(id, { entry: node, path: [...path], item: { id, revision: id, name, originalPath: '/'+path.join('/'), deletedAt: new Date().toISOString(), type: node.kind === 'dir' ? 'directory' : 'file', sizeBytes: node.size, canRestore: true } });
  parent.children?.splice(index, 1);
  revisions.delete(pathKey(path));
}

export function createEntry(path: string[], kind: 'file' | 'directory'): void {
  const name = path.at(-1) ?? '';
  const parent = getEntry(path.slice(0, -1));
  if (!name || name === '.' || name === '..' || /[\/\x00]/.test(name)) throw new ApiError('validation_failed', 'Choose a valid name.');
  if (!parent || parent.kind !== 'dir') throw new ApiError('not_found', 'Folder unavailable.');
  if (parent.children?.some((entry) => entry.name === name)) throw new ApiError('conflict', 'A file or folder with this name already exists.');
  parent.children ??= [];
  parent.children.push({ name, kind: kind === 'directory' ? 'dir' : 'file', size: 0, modified: formatModified(new Date().toISOString()), ...(kind === 'directory' ? { children: [] } : { content: '' }) });
}

const trashed = new Map<string, { entry: FsEntry; path: string[]; item: TrashItem }>();
export function listTrashed(): TrashItem[] { return [...trashed.values()].map(({ item }) => ({ ...item })); }
export function restoreTrashed(item: TrashSelection): string {
  const value = trashed.get(item.id);
  if (!value || value.item.revision !== item.revision) throw new ApiError('stale_revision', 'Refresh Trash and try again.');
  const parent = getEntry(value.path.slice(0,-1));
  if (!parent || parent.kind !== 'dir') throw new ApiError('not_found', 'Original folder unavailable.');
  if (parent.children?.some((entry) => entry.name === value.entry.name)) throw new ApiError('conflict', 'A file or folder with this name already exists.');
  parent.children ??= [];
  parent.children.push(value.entry);
  trashed.delete(item.id);
  return value.item.originalPath;
}
export function removeTrashed(items: TrashSelection[]): void {
  if (items.some((item) => trashed.get(item.id)?.item.revision !== item.revision)) throw new ApiError('stale_revision', 'Refresh Trash and try again.');
  for (const item of items) trashed.delete(item.id);
}
