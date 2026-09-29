// SPDX-License-Identifier: AGPL-3.0-only
import type { Skill } from '../api/skills';

export function composerTokens(value: string, skills: Skill[]) {
  return [...value.matchAll(/(^|\s)(\/skill:[\w.-]+)(?=\s|$)/g)].flatMap((match) => {
    const start = match.index! + match[1].length; const text = match[2];
    const skill = text.startsWith('/skill:');
    if (skill ? !skills.some((item) => !item.issue && item.name === text.slice(7)) : Boolean(value.slice(0, start).trim())) return [];
    return [{ start, end: start + text.length, text, skill }];
  });
}

export function composerText(node: Node): string {
  if (node instanceof HTMLElement && node.dataset.commandToken) return node.dataset.commandToken;
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeName === 'BR') return (node as HTMLElement).dataset.composerEnd ? '' : '\n';
  return [...node.childNodes].map((child, index) => (index > 0 && child.nodeName === 'DIV' ? '\n' : '') + composerText(child)).join('');
}

export function composerSelection(node: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !node.contains(selection.anchorNode) || !node.contains(selection.focusNode)) return null;
  const range = selection.getRangeAt(0); const before = range.cloneRange();
  before.selectNodeContents(node); before.setEnd(range.startContainer, range.startOffset);
  const start = composerText(before.cloneContents()).length;
  return { start, end: start + composerText(range.cloneContents()).length };
}

export function placeComposerCaret(node: HTMLElement, start: number, end = start) {
  const locate = (offset: number): [Node, number] => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT); let text = walker.nextNode();
    while (text) {
      const chip = text.parentElement?.closest<HTMLElement>('[data-command-token]');
      const length = chip?.dataset.commandToken?.length ?? text.textContent?.length ?? 0;
      if (offset <= length) {
        if (chip?.parentNode) return [chip.parentNode, [...chip.parentNode.childNodes].indexOf(chip) + (offset ? 1 : 0)];
        return [text, offset];
      }
      offset -= length; text = walker.nextNode();
    }
    return [node, node.childNodes.length];
  };
  const range = document.createRange(); range.setStart(...locate(start)); range.setEnd(...locate(end));
  const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
}
