// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { composerTokens, composerText, composerSelection, placeComposerCaret } from './piComposerTokens';
import type { PiTemplate } from '../api/pi';
import { expandTemplate, templateParts } from './piTemplates';
import type { Skill } from '../api/skills';
import { useMenuInput } from '../shell/useMenuInput';
import { IconCode, IconSkills } from '../shell/icons';

export type PiChatAction = 'undo' | 'rename' | 'compact';
export const chatActions: { name: PiChatAction; description: string }[] = [
  { name: 'undo', description: 'Edit an earlier message and resend' },
  { name: 'rename', description: 'Rename this conversation' },
  { name: 'compact', description: 'Compact conversation context' },
];

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onAction: (action: PiChatAction, remaining: string) => void;
  inputRef: RefObject<HTMLDivElement>;
  skills: Skill[];
  templates?: PiTemplate[];
  onImages?: (files: File[]) => void;
  disabled: boolean;
  actionDisabled: (action: PiChatAction) => boolean;
}

export function PiComposerInput({ value, onChange, onSend, onAction, inputRef, skills, templates = [], onImages, disabled, actionDisabled }: Props) {
  const id = useId();
  const [composing, setComposing] = useState(false);
  const pendingCaret = useRef<number | null>(null);
  const history = useRef({ expected: value, past: [] as string[], future: [] as string[], changed: 0 });
  function update(next: string, group = false) {
    if (next !== value) {
      const now = Date.now();
      if (!group || now - history.current.changed > 500) history.current.past = [...history.current.past, value].slice(-100);
      history.current.future = []; history.current.changed = group ? now : 0; history.current.expected = next;
    }
    onChange(next);
  }
  useLayoutEffect(() => {
    const node = inputRef.current;
    if (!node || composing) return;
    if (history.current.expected !== value) history.current = { expected: value, past: [], future: [], changed: 0 };
    const selection = document.activeElement === node ? composerSelection(node) : null;
    const fragment = document.createDocumentFragment(); let offset = 0;
    for (const token of composerTokens(value, skills)) {
      fragment.append(document.createTextNode(value.slice(offset, token.start)));
      const chip = document.createElement('span'); chip.className = 'pi-command-token'; chip.contentEditable = 'false'; chip.dataset.commandToken = token.text; chip.dataset.commandKind = token.skill ? 'skill' : 'action';
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('fill', 'none'); icon.setAttribute('stroke', 'currentColor'); icon.setAttribute('stroke-width', '1.6');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', token.skill ? 'M12 5v15M12 5C9 3 5 3 3 4v14c3-1 6-1 9 2 3-3 6-3 9-2V4c-2-1-6-1-9 1Z' : 'm9 7-5 5 5 5m6-10 5 5-5 5'); icon.append(path); chip.append(icon, document.createTextNode(token.skill ? token.text.slice(7) : token.text)); fragment.append(chip); offset = token.end;
    }
    fragment.append(document.createTextNode(value.slice(offset)));
    if (value.endsWith('\n')) { const end = document.createElement('br'); end.dataset.composerEnd = 'true'; fragment.append(end); }
    node.replaceChildren(fragment);
    node.dataset.canUndo = String(history.current.past.length > 0); node.dataset.canRedo = String(history.current.future.length > 0);
    if (pendingCaret.current !== null) { node.focus(); placeComposerCaret(node, pendingCaret.current); setCaret(pendingCaret.current); pendingCaret.current = null; }
    else if (selection) placeComposerCaret(node, selection.start, selection.end);
  }, [value, skills, composing]);
  const host = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const menuInput = useMenuInput(true);
  const fragment = !dismissed && focused && !disabled ? /(?:^|\s)\/([\w:-]*)$/.exec(value.slice(0, caret)) : null;
  const start = fragment ? caret - fragment[1].length - 1 : -1;
  const query = fragment?.[1].toLowerCase() ?? '';
  const leading = start >= 0 && !value.slice(0, start).trim();
  const options = fragment ? [
    ...(leading ? chatActions.filter((action) => action.name.startsWith(query)).map((action) => ({ ...action, key: action.name, action: action.name, template: undefined as PiTemplate | undefined, disabled: actionDisabled(action.name) })) : []),
    ...(leading ? templates.filter((item) => item.name.toLowerCase().startsWith(query)).map((item) => ({ name: item.name, description: templateParts(item.content).description, key: `template:${item.name}`, action: undefined, template: item, disabled: false })) : []),
    ...skills.filter((skill) => !skill.issue && /^[\w.-]+$/.test(skill.name) && (`skill:${skill.name}`.toLowerCase().startsWith(query) || skill.name.toLowerCase().startsWith(query))).map((skill) => ({ name: `skill:${skill.name}`, description: skill.description || 'Use this skill', key: skill.id, action: undefined, template: undefined as PiTemplate | undefined, disabled: false })),
  ] : [];
  const current = Math.min(active, Math.max(0, options.length - 1));
  const open = Boolean(fragment && options.length);
  useEffect(() => { setDismissed(false); setActive(0); }, [value]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!host.current?.contains(event.target as Node)) setDismissed(true); };
    window.addEventListener('pointerdown', outside, true);
    return () => window.removeEventListener('pointerdown', outside, true);
  }, [open]);
  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    setDismissed(true);
    if (option.action) { onAction(option.action, value.slice(0, start) + value.slice(caret).replace(/^\s+/, '')); return; }
    const inserted = option.template ? expandTemplate(option.template) : `/${option.name} `;
    pendingCaret.current = start + inserted.length;
    update(value.slice(0, start) + inserted + value.slice(caret));
  }
  function insertText(text: string) {
    const selection = inputRef.current && composerSelection(inputRef.current);
    if (!selection) return;
    pendingCaret.current = selection.start + text.length;
    update(value.slice(0, selection.start) + text + value.slice(selection.end));
  }
  function undoEdit(redo: boolean) {
    const from = redo ? history.current.future : history.current.past;
    const next = from.pop();
    if (next !== undefined) { (redo ? history.current.past : history.current.future).push(value); history.current.expected = next; history.current.changed = 0; pendingCaret.current = next.length; onChange(next); }
  }
  useLayoutEffect(() => {
    const node = inputRef.current;
    if (!node || disabled) return;
    const edit = (event: Event) => {
      const { command, text } = (event as CustomEvent<{ command: string; text?: string }>).detail;
      if (command === 'undo' || command === 'redo') undoEdit(command === 'redo');
      else if (command === 'insertText' || command === 'delete') insertText(text ?? '');
    };
    node.addEventListener('lumo-editor-command', edit);
    return () => node.removeEventListener('lumo-editor-command', edit);
  });
  return <div ref={host} className="pi-composer-input" {...menuInput}>
    {open && <div className="pi-slash-menu menu-surface" data-menu-input={menuInput['data-menu-input']} id={id} role="listbox" aria-label="Commands and skills" data-testid="pi-slash-menu">
      {options.map((option, index) => <button type="button" role="option" tabIndex={-1} id={`${id}-${index}`} key={option.key} aria-selected={index === current} disabled={option.disabled} className={`popup-item${index === current ? ' highlighted' : ''}`} onPointerMove={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(index)}>
        <span className="pi-slash-icon" aria-hidden="true">{option.action ? <IconCode size={16}/> : <IconSkills size={16}/>}</span><span><strong>/{option.name}</strong><small>{option.disabled ? 'Available when this chat is idle and has messages' : option.description}</small></span>
      </button>)}
    </div>}
    <div ref={inputRef} className="input pi-composer-editor" role="textbox" contentEditable={!disabled} suppressContentEditableWarning tabIndex={disabled ? -1 : 0} data-rich-editor="true" data-testid="pi-prompt" aria-label="Message Pi" aria-disabled={disabled} aria-multiline="true" aria-autocomplete="list" aria-controls={open ? id : undefined} aria-expanded={open} aria-activedescendant={open ? `${id}-${current}` : undefined} data-placeholder="Message Pi… Type / for commands" onFocus={() => { setFocused(true); setDismissed(false); }} onBlur={() => setFocused(false)} onSelect={() => { const selection = inputRef.current && composerSelection(inputRef.current); if (selection) setCaret(selection.end); }} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => { setComposing(false); if (inputRef.current) update(composerText(inputRef.current), true); }} onInput={(event) => { setFocused(true); setDismissed(false); const selection = composerSelection(event.currentTarget); setCaret(selection?.end ?? 0); update(composerText(event.currentTarget), (event.nativeEvent as InputEvent).inputType === 'insertText'); }} onPaste={(event) => { event.preventDefault(); const files = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/')); if (files.length && onImages) onImages(files); const text = event.clipboardData.getData('text/plain'); if (text) insertText(text); }} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return;
      if ((event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault(); undoEdit(event.shiftKey || event.key.toLowerCase() === 'y');
        return;
      }
      if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissed(true); return; }
      if (open && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault(); const next = (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length; setActive(next); document.getElementById(`${id}-${next}`)?.scrollIntoView({ block: 'nearest' }); return;
      }
      if (open && ((event.key === 'Tab' && !event.shiftKey) || (event.key === 'Enter' && !event.shiftKey))) { event.preventDefault(); choose(current); return; }
      if (event.key === 'Enter') { event.preventDefault(); if (event.shiftKey) insertText('\n'); else onSend(); return; }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        const selection = inputRef.current && composerSelection(inputRef.current);
        if (selection && selection.start === selection.end) {
          const token = composerTokens(value, skills).find((item) => event.key === 'Backspace' ? selection.start === item.end || (selection.start === item.end + 1 && value[item.end] === ' ') : selection.start === item.start);
          if (token) { event.preventDefault(); pendingCaret.current = token.start; update(value.slice(0, token.start) + value.slice(event.key === 'Backspace' ? selection.start : token.end)); }
        }
      }
    }}/>
  </div>;
}
