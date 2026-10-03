// SPDX-License-Identifier: AGPL-3.0-only
import { appMenuCategories, type AppMenus } from '../shell/appMenus';
export function frameMenus(value: unknown, run: (id: string) => void): AppMenus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('setMenus expects an object.');
  const menus: AppMenus = {};
  let count = 0;
  const ids = new Set<string>();
  for (const [key, list] of Object.entries(value)) {
    if (!appMenuCategories.includes(key as typeof appMenuCategories[number]) || !Array.isArray(list)) throw new Error('Unsupported menu category.');
    menus[key as keyof AppMenus] = list.map((item: unknown) => {
      if (++count > 64 || !item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Use at most 64 menu commands.');
      const command = item as Record<string, unknown>;
      if (Object.keys(command).some((field) => !['id', 'label', 'disabled', 'checked', 'hint', 'separatorAbove', 'keywords', 'palette'].includes(field))) throw new Error('Unsupported command field.');
      if (typeof command.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(command.id) || typeof command.label !== 'string' || !command.label.trim() || command.label.length > 80) throw new Error('Commands need a stable id and a short label.');
      if (['disabled', 'checked', 'separatorAbove', 'palette'].some((field) => command[field] !== undefined && typeof command[field] !== 'boolean') || ['hint', 'keywords'].some((field) => command[field] !== undefined && (typeof command[field] !== 'string' || (command[field] as string).length > 120))) throw new Error('Invalid command options.');
      const id = command.id;
      if (ids.has(key + ':' + id)) throw new Error('Duplicate command id in menu.');
      ids.add(key + ':' + id);
      return { id, label: command.label, disabled: command.disabled as boolean | undefined, checked: command.checked as boolean | undefined, hint: command.hint as string | undefined, separatorAbove: command.separatorAbove as boolean | undefined, keywords: command.keywords as string | undefined, palette: command.palette as boolean | undefined, run: () => run(id) };
    });
  }
  return menus;
}
export function framePresentation(value: unknown): { title?: string; badge?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('setPresentation expects an object.');
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).some((key) => key !== 'title' && key !== 'badge') || ['title', 'badge'].some((key) => fields[key] !== undefined && (typeof fields[key] !== 'string' || (fields[key] as string).length > (key === 'title' ? 120 : 8)))) throw new Error('Use a title up to 120 characters and badge up to 8.');
  return fields as { title?: string; badge?: string };
}
