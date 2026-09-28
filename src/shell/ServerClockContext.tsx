// SPDX-License-Identifier: AGPL-3.0-only
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getDataSource, type SystemSettings } from '../api/source';
import { useNow } from './ShellContext';

type Clock = { serverTime: number; timezone: string; receivedAt: number };
const ClockContext = createContext<{ clock: Clock | null; publish: (settings: SystemSettings) => void } | null>(null);

export function ServerClockProvider({ children }: { children: ReactNode }) {
  const [clock, setClock] = useState<Clock | null>(null);
  const generation = useRef(0);
  const publish = useCallback((settings: SystemSettings) => {
    const serverTime = Date.parse(settings.serverTime);
    if (!Number.isFinite(serverTime) || !settings.timezone) return;
    try { new Intl.DateTimeFormat(undefined, { timeZone: settings.timezone }); } catch { return; }
    generation.current++;
    setClock({ serverTime, timezone: settings.timezone, receivedAt: performance.now() });
  }, []);
  useEffect(() => {
    let active = true;
    let pending = false;
    const refresh = async () => {
      if (pending || document.hidden) return;
      pending = true;
      const version = generation.current;
      try {
        const next = await getDataSource().getSystemSettings();
        if (active && generation.current === version) publish(next);
      } catch {} finally { pending = false; }
    };
    const resume = () => { void refresh(); };
    resume();
    const timer = window.setInterval(resume, 30_000);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', resume); window.removeEventListener('focus', resume); };
  }, [publish]);
  const value = useMemo(() => ({ clock, publish }), [clock, publish]);
  return <ClockContext.Provider value={value}>{children}</ClockContext.Provider>;
}

export function useServerClockSource() {
  const context = useContext(ClockContext);
  if (!context) throw new Error('Server clock requires its provider');
  return context;
}

export function useServerClock() {
  const { clock } = useServerClockSource();
  useNow(1000);
  return { instant: clock ? new Date(clock.serverTime + performance.now() - clock.receivedAt) : null, timezone: clock?.timezone };
}
