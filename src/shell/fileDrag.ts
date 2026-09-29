// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { describeError, getDataSource } from '../api/source';
import { ApiError } from '../api/transport';
import { useShell } from './ShellContext';
import { setDragPreview } from './dragPreview';

const MIME = 'application/x-lumo-file-selection';
let drag: { token: string; paths: string[][]; kinds: ('dir' | 'file')[]; folder: string[] | null } | null = null;
let transferring = false;

export function endFileDrag() {
  drag = null;
  document.querySelectorAll('[data-file-drop-target]').forEach((node) => node.removeAttribute('data-file-drop-target'));
}

export function startFileDrag(event: DragEvent, items: { path: string[]; kind: 'dir' | 'file' }[]) {
  const paths = items.map((item) => [...item.path]);
  if (transferring || !paths.length) { event.preventDefault(); return; }
  drag = { token: crypto.randomUUID(), paths, kinds: items.map((item) => item.kind), folder: items.length === 1 && items[0].kind === 'dir' ? paths[0] : null };
  event.dataTransfer.effectAllowed = 'copyMove';
  event.dataTransfer.setData(MIME, drag.token);
  event.dataTransfer.setData('text/plain', paths.map((path) => getDataSource().absolutePath(path)).join('\n'));
  setDragPreview(event, paths[0].at(-1) || '/', items[0].kind === 'dir' ? 'folder' : 'file', items.length);
}

export function useFileDragNavigation(destination: string | null, navigate: () => void) {
  const [pending, setPending] = useState(false);
  const timer = useRef<number>();
  const hovered = useRef(false);
  function cancel() {
    window.clearTimeout(timer.current); timer.current = undefined;
    hovered.current = false; setPending(false);
  }
  useEffect(() => {
    window.addEventListener('dragend', cancel, true);
    window.addEventListener('drop', cancel, true);
    window.addEventListener('blur', cancel);
    return () => {
      window.clearTimeout(timer.current);
      window.removeEventListener('dragend', cancel, true);
      window.removeEventListener('drop', cancel, true);
      window.removeEventListener('blur', cancel);
    };
  }, []);
  useEffect(() => {
    window.clearTimeout(timer.current); timer.current = undefined; setPending(false);
  }, [destination]);
  return {
    'data-drag-navigating': pending || undefined,
    onDragOver(event: DragEvent<HTMLElement>) {
      if (!destination || !drag || transferring || !event.dataTransfer.types.includes(MIME)) return;
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
      if (hovered.current) return;
      hovered.current = true; setPending(true);
      const token = drag.token;
      timer.current = window.setTimeout(() => {
        timer.current = undefined; setPending(false);
        if (drag?.token === token && !transferring) navigate();
      }, 900);
    },
    onDragLeave(event: DragEvent<HTMLElement>) {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) cancel();
    },
    onDrop(event: DragEvent<HTMLElement>) {
      event.preventDefault(); event.stopPropagation(); cancel();
    },
  };
}

export function folderDrop(onFolder: (path: string) => void, onInvalid: () => void) {
  const accepts = (event: DragEvent) => Boolean(drag?.folder && !transferring && event.dataTransfer.types.includes(MIME));
  return {
    onDragOver(event: DragEvent<HTMLElement>) {
      event.preventDefault(); event.stopPropagation();
      event.dataTransfer.dropEffect = accepts(event) ? 'copy' : 'none';
      if (accepts(event)) event.currentTarget.dataset.fileDropTarget = 'true';
    },
    onDragLeave(event: DragEvent<HTMLElement>) {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) delete event.currentTarget.dataset.fileDropTarget;
    },
    onDrop(event: DragEvent<HTMLElement>) {
      event.preventDefault(); event.stopPropagation();
      delete event.currentTarget.dataset.fileDropTarget;
      if (!accepts(event) || !drag?.folder || event.dataTransfer.getData(MIME) !== drag.token) { onInvalid(); return; }
      const path = getDataSource().absolutePath(drag.folder);
      endFileDrag();
      onFolder(path);
    },
  };
}

export function fileReferenceDrop(onPaths: (paths: string[]) => void) {
  const accepts = (event: DragEvent) => Boolean(drag && !transferring && event.dataTransfer.types.includes(MIME));
  return {
    onDragOver(event: DragEvent<HTMLElement>) {
      event.preventDefault(); event.stopPropagation();
      event.dataTransfer.dropEffect = accepts(event) ? 'copy' : 'none';
      if (accepts(event)) event.currentTarget.dataset.fileDropTarget = 'true';
    },
    onDragLeave(event: DragEvent<HTMLElement>) {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) delete event.currentTarget.dataset.fileDropTarget;
    },
    onDrop(event: DragEvent<HTMLElement>) {
      event.preventDefault(); event.stopPropagation(); delete event.currentTarget.dataset.fileDropTarget;
      if (!accepts(event) || !drag || event.dataTransfer.getData(MIME) !== drag.token) return;
      const paths = drag.paths.map((path, index) => {
        const absolute = getDataSource().absolutePath(path);
        return drag!.kinds[index] === 'dir' && !absolute.endsWith('/') ? absolute + '/' : absolute;
      });
      endFileDrag(); onPaths(paths);
    },
  };
}

export function useFileDrop() {
  const { actions } = useShell();
  const source = getDataSource();
  return (destination: string[] | 'trash' | null) => {
    const accepts = (event: DragEvent) => {
      if (!drag || transferring || destination === null || !event.dataTransfer.types.includes(MIME)) return false;
      if (destination === 'trash') return true;
      const target = source.absolutePath(destination);
      return drag.paths.every((path) => {
        const from = source.absolutePath(path);
        return target !== from && !target.startsWith(from + '/') && target !== source.absolutePath(path.slice(0, -1));
      });
    };
    return {
      onDragOver(event: DragEvent<HTMLElement>) {
        if (!accepts(event)) return;
        event.preventDefault(); event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        event.currentTarget.dataset.fileDropTarget = 'true';
      },
      onDragLeave(event: DragEvent<HTMLElement>) {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) delete event.currentTarget.dataset.fileDropTarget;
      },
      onDrop(event: DragEvent<HTMLElement>) {
        delete event.currentTarget.dataset.fileDropTarget;
        if (!accepts(event) || !drag || event.dataTransfer.getData(MIME) !== drag.token || destination === null) return;
        event.preventDefault(); event.stopPropagation();
        const paths = drag.paths;
        endFileDrag();
        transferring = true;
        void (async () => {
          const failures: string[] = [];
          let moved = 0;
          try {
            for (const path of paths) {
              try {
                if (destination === 'trash') await source.deleteFile(path);
                else await source.moveFile(path, [...destination, path.at(-1)!]);
                moved++;
              } catch (error) { failures.push(`${path.at(-1)}: ${error instanceof ApiError && error.code === 'conflict' ? 'A file or folder with this name already exists in the destination.' : describeError(error)}`); }
            }
          } finally {
            transferring = false;
            if (moved) actions.filesChanged();
          }
          if (failures.length) actions.notify(destination === 'trash' ? 'Could not move all items to Trash' : 'Could not move all items', failures.join('\n'));
        })();
      },
    };
  };
}
