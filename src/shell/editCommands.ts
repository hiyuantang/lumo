// SPDX-License-Identifier: AGPL-3.0-only
import { copyText, readClipboard } from '../utils/clipboard';
import type { AppCommand } from './appMenus';

export function editCommands(target: HTMLElement | null, unavailable: () => void): AppCommand[] {
  const editor = target?.closest<HTMLElement>('[data-rich-editor="true"]');
  if (editor) {
    const selected = window.getSelection();
    const range = selected?.rangeCount && editor.contains(selected.anchorNode) && editor.contains(selected.focusNode) ? selected.getRangeAt(0).cloneRange() : null;
    const selection = range?.toString() ?? '';
    const editable = editor.isContentEditable && editor.getAttribute('aria-disabled') !== 'true';
    const insert = (command: string, text?: string) => {
      if (!editable || !editor.isConnected) return;
      editor.focus(); const current = window.getSelection();
      if (range) { current?.removeAllRanges(); current?.addRange(range); }
      editor.dispatchEvent(new CustomEvent('lumo-editor-command', { detail: { command, text } }));
    };
    return [
      { id: 'undo', label: 'Undo', hint: '⌘Z', disabled: !editable || editor.dataset.canUndo !== 'true', run: () => insert('undo') },
      { id: 'redo', label: 'Redo', hint: '⇧⌘Z', disabled: !editable || editor.dataset.canRedo !== 'true', run: () => insert('redo') },
      { id: 'cut', label: 'Cut', hint: '⌘X', separatorAbove: true, disabled: !editable || !selection, run: () => { void copyText(selection).then(() => insert('delete')).catch(unavailable); } },
      { id: 'copy', label: 'Copy', hint: '⌘C', disabled: !selection, run: () => { void copyText(selection).catch(unavailable); } },
      { id: 'paste', label: 'Paste', hint: '⌘V', disabled: !editable, run: () => { void readClipboard().then((text) => insert('insertText', text)).catch(unavailable); } },
      { id: 'select-all', label: 'Select All', hint: '⌘A', separatorAbove: true, disabled: !editable, run: () => { editor.focus(); const all = document.createRange(); all.selectNodeContents(editor); const current = window.getSelection(); current?.removeAllRanges(); current?.addRange(all); } },
    ];
  }
  const input = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target : null;
  const textField = input && ['text', 'search', 'url', 'tel', 'password', 'textarea'].includes(input.type) ? input : null;
  const editable = !!textField && !textField.readOnly && !textField.disabled;
  const start = textField?.selectionStart ?? 0;
  const end = textField?.selectionEnd ?? 0;
  const selection = textField ? textField.value.slice(start, end) : window.getSelection()?.toString() ?? '';
  const canCopy = !!target && !!selection && textField?.type !== 'password';
  const focus = () => { if (textField?.isConnected) { textField.focus(); textField.setSelectionRange(start, end); } };
  const insert = (command: string, text?: string) => { if (!textField?.isConnected || textField.readOnly || textField.disabled) return; focus(); if (!document.execCommand(command, false, text)) unavailable(); };
  const previous = document.activeElement as HTMLElement | null;
  if (editable) focus();
  const canUndo = editable && document.queryCommandEnabled('undo');
  const canRedo = editable && document.queryCommandEnabled('redo');
  if (editable && previous !== textField) previous?.focus();
  return [
    { id: 'undo', label: 'Undo', hint: '⌘Z', disabled: !canUndo, run: () => insert('undo') },
    { id: 'redo', label: 'Redo', hint: '⇧⌘Z', disabled: !canRedo, run: () => insert('redo') },
    { id: 'cut', label: 'Cut', hint: '⌘X', separatorAbove: true, disabled: !editable || !canCopy, run: () => { void copyText(selection).then(() => insert('delete')).catch(unavailable); } },
    { id: 'copy', label: 'Copy', hint: '⌘C', disabled: !canCopy, run: () => { void copyText(selection).catch(unavailable); } },
    { id: 'paste', label: 'Paste', hint: '⌘V', disabled: !editable, run: () => { void readClipboard().then((text) => insert('insertText', text)).catch(unavailable); } },
    { id: 'select-all', label: 'Select All', hint: '⌘A', separatorAbove: true, disabled: !textField || textField.disabled, run: () => { textField?.focus(); textField?.select(); } },
  ];
}
