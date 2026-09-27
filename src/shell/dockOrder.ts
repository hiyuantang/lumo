// SPDX-License-Identifier: AGPL-3.0-only
import { APP_ORDER, type AppId } from '../apps/registry';

export const DOCK_ORDER_KEY = 'lumo.dock.v1';

export function loadDockOrder(): AppId[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(DOCK_ORDER_KEY) ?? 'null');
    if (Array.isArray(saved)) {
      const known = saved.filter((id): id is AppId => APP_ORDER.includes(id));
      return [...new Set([...known, ...APP_ORDER])];
    }
  } catch {}
  return [...APP_ORDER];
}

export function moveDockApp(order: AppId[], app: AppId, target: AppId): AppId[] {
  const from = order.indexOf(app);
  const to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, app);
  return next;
}
