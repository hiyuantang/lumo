// SPDX-License-Identifier: AGPL-3.0-only
import { createElement, Fragment, type ReactNode } from 'react';

function safeLink(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}

type ImageRenderer = (path: string, alt: string) => ReactNode;
type InlineTokens = Record<string, ReactNode>;

function inline(text: string, depth = 0, tokens?: InlineTokens, images?: ImageRenderer): ReactNode {
  if (depth > 8) return text;
  const pattern = /(`+)([^`\n]+)\1|!?\[([^\]\n]+)\]\(([^\s)]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|_([^_\n]+)_|~~([^~\n]+)~~/g;
  const names = Object.keys(tokens ?? {});
  const matcher = names.length ? new RegExp(pattern.source + '|(?<!\\S)(' + names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?=\\s|$|[,!?])', 'g') : pattern;
  const nodes: ReactNode[] = [];
  let end = 0;
  for (const match of text.matchAll(matcher)) {
    nodes.push(text.slice(end, match.index));
    const key = match.index;
    if (match[10]) nodes.push(<Fragment key={key}>{tokens?.[match[10]] ?? match[10]}</Fragment>);
    else if (match[2]) nodes.push(<code key={key}>{match[2]}</code>);
    else if (match[3]) {
      if (match[0].startsWith('!') && images) { nodes.push(<Fragment key={key}>{images(match[4], match[3])}</Fragment>); end = match.index! + match[0].length; continue; }
      const href = safeLink(match[4]);
      nodes.push(href ? <a key={key} href={href} target="_blank" rel="noopener noreferrer">{match[0].startsWith('!') ? `Image: ${match[3]}` : inline(match[3], depth + 1, tokens, images)}</a> : <span key={key}>{match[3]}</span>);
    } else if (match[5] || match[6]) nodes.push(<strong key={key}>{inline(match[5] ?? match[6], depth + 1, tokens, images)}</strong>);
    else if (match[7] || match[8]) nodes.push(<em key={key}>{inline(match[7] ?? match[8], depth + 1, tokens, images)}</em>);
    else nodes.push(<del key={key}>{inline(match[9], depth + 1, tokens, images)}</del>);
    end = match.index! + match[0].length;
  }
  nodes.push(text.slice(end));
  return nodes;
}

const startsBlock = (line: string) => /^(#{1,6}\s|```|~~~|>\s?|\s*[-+*]\s|\s*\d+[.)]\s|\s*(?:---+|\*\*\*+|___+)\s*$)/.test(line);
const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());

function blocks(text: string, depth = 0, tokens?: InlineTokens, images?: ImageRenderer): ReactNode[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const output: ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const key = index;
    if (!line.trim()) { index++; continue; }
    const fence = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index].trim().startsWith(fence[1])) code.push(lines[index++]);
      if (index < lines.length) index++;
      output.push(<pre key={key}><code>{code.join('\n')}</code></pre>);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) { output.push(createElement(`h${heading[1].length}`, { key }, inline(heading[2], 0, tokens, images))); index++; continue; }
    if (index + 1 < lines.length && /^\s*(===+|---+)\s*$/.test(lines[index + 1])) {
      output.push(createElement(lines[index + 1].trim().startsWith('=') ? 'h1' : 'h2', { key }, inline(line, 0, tokens, images))); index += 2; continue;
    }
    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) { output.push(<hr key={key} />); index++; continue; }
    if (line.startsWith('>') && depth < 8) {
      const quote: string[] = [];
      while (index < lines.length && lines[index].startsWith('>')) quote.push(lines[index++].replace(/^>\s?/, ''));
      output.push(<blockquote key={key}>{blocks(quote.join('\n'), depth + 1, tokens, images)}</blockquote>); continue;
    }
    if (line.includes('|') && index + 1 < lines.length && cells(lines[index + 1]).every((cell) => /^:?-{3,}:?$/.test(cell))) {
      const headers = cells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) rows.push(cells(lines[index++]));
      output.push(<div className="markdown-table" key={key}><table><thead><tr>{headers.map((cell, i) => <th key={i}>{inline(cell, 0, tokens, images)}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{headers.map((_, j) => <td key={j}>{inline(row[j] ?? '', 0, tokens, images)}</td>)}</tr>)}</tbody></table></div>); continue;
    }
    const item = line.match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
    if (item) {
      const ordered = /^\d/.test(item[1]);
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const next = lines[index].match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
        if (!next || /^\d/.test(next[1]) !== ordered) break;
        const task = next[2].match(/^\[([ xX])\]\s+(.*)$/);
        items.push(<li key={index}>{task ? <><input type="checkbox" checked={task[1].toLowerCase() === 'x'} readOnly tabIndex={-1} aria-label={task[2]} /> {inline(task[2], 0, tokens, images)}</> : inline(next[2], 0, tokens, images)}</li>);
        index++;
      }
      output.push(ordered ? <ol key={key} start={parseInt(item[1])}>{items}</ol> : <ul key={key}>{items}</ul>); continue;
    }
    const paragraph = [line];
    index++;
    while (index < lines.length && lines[index].trim() && !startsBlock(lines[index])) {
      if (lines[index].includes('|') && index + 1 < lines.length && cells(lines[index + 1]).every((cell) => /^:?-{3,}:?$/.test(cell))) break;
      paragraph.push(lines[index++]);
    }
    output.push(<p key={key}>{inline(paragraph.join('\n'), 0, tokens, images)}</p>);
  }
  return output;
}

export function Markdown({ text, tokens, images }: { text: string; tokens?: InlineTokens; images?: ImageRenderer }) {
  return <article className="markdown" data-testid="preview-rendered">{blocks(text, 0, tokens, images)}</article>;
}
