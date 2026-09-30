// SPDX-License-Identifier: AGPL-3.0-only
import type { PiTemplate } from '../api/pi';

export const initialTemplate: PiTemplate = { name: 'init', revision: '', path: '', content: '---\ndescription: Create or update project guidance\n---\nInspect this project and its existing instructions. Create or update a concise AGENTS.md with the verified project purpose, structure, development commands, tests and conventions. Preserve existing useful guidance. Do not guess commands or change unrelated files. Follow the selected permission mode; if editing is unavailable, show a proposed draft instead.\n\n$ARGUMENTS' };
export function templateCatalog(templates: PiTemplate[]) { return templates.some((item) => item.name === 'init') ? templates : [initialTemplate, ...templates]; }
export function templateParts(content: string) {
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  const body = header ? content.slice(header[0].length) : content;
  let description = header?.[1].match(/^description:\s*(.*)$/m)?.[1].trim() ?? '';
  if (description.startsWith('"')) { try { description = JSON.parse(description); } catch {} }
  else if (description.startsWith("'") && description.endsWith("'")) description = description.slice(1, -1).replace(/''/g, "'");
  return { body, description: description || body.split('\n').find((line) => line.trim()) || 'Use this prompt' };
}
export function templateContent(original: string, description: string, body: string) {
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(original);
  const fields = (header?.[1] ?? '').split('\n').filter((line) => !/^description:/.test(line));
  return `---\ndescription: ${JSON.stringify(description)}${fields.some((line) => line.trim()) ? '\n' + fields.join('\n') : ''}\n---\n${body}`;
}
function argumentsOf(text: string) {
  const args: string[] = []; let current = ''; let quote = ''; let started = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && quote !== "'") { if (i + 1 < text.length) { current += text[++i]; started = true; } else current += c; }
    else if (quote) { if (c === quote) quote = ''; else current += c; }
    else if (c === '"' || c === "'") { quote = c; started = true; }
    else if (/\s/.test(c)) { if (started) { args.push(current); current = ''; started = false; } }
    else { current += c; started = true; }
  }
  if (quote) throw new Error('Close the quote in your template arguments.');
  if (started) args.push(current);
  return args;
}
export function expandTemplate(template: PiTemplate, text = '') {
  const args = argumentsOf(text);
  return templateParts(template.content).body.replace(/\$\{(\d+|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g, (_match, index: string, fallback: string, start: string, length: string, simple: string) => {
    if (start) return args.slice(Math.max(0, Number(start) - 1), length ? Math.max(0, Number(start) - 1) + Number(length) : undefined).join(' ');
    const key = index || simple;
    const value = key === '@' || key === 'ARGUMENTS' ? args.join(' ') : args[Number(key) - 1] ?? '';
    return value || fallback || '';
  }).trim();
}
export function expandTemplateCommand(text: string, templates: PiTemplate[]) {
  const command = /^\s*\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text);
  const template = command && templates.find((item) => item.name === command[1]);
  return template ? expandTemplate(template, command?.[2]) : text;
}
