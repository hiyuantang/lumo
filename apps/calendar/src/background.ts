// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react';
import { useShell } from '@lumo/sdk/shell/ShellContext';
import { getDataSource } from '@lumo/sdk/api/source';

export default function CalendarNotifications() {
  const { actions } = useShell();
  useEffect(() => {
    let alive = true, pending = false;
    if (new URLSearchParams(window.location.search).has('calendar')) actions.openApp('calendar');
    const source = getDataSource();
    const poll = async () => { if (pending) return; pending = true; try { const notices = await source.calendarNotices(); if (alive) for (const notice of notices) actions.notify(notice.title, notice.body); } catch {} finally { pending = false; } };
    void poll(); const timer = window.setInterval(() => void poll(), 60_000);
    const resume = () => void poll(); window.addEventListener('focus', resume); window.addEventListener('lumo-calendar-changed', resume);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('focus', resume); window.removeEventListener('lumo-calendar-changed', resume); };
  }, [actions]);
  return null;
}
