// SPDX-License-Identifier: AGPL-3.0-only
import type { AppId } from '../apps/registry';
import artwork from '../assets/lumo-app-icons.webp';
import '../styles/app-icon.css';

const positions: Record<Exclude<AppId, 'git'>, [number, number]> = {
  home: [60, 50],
  files: [404, 50],
  preview: [746, 50],
  terminal: [1087, 50],
  pi: [60, 389],
  containers: [404, 389],
  websites: [746, 389],
  library: [1087, 389],
  skills: [60, 728],
  settings: [404, 728],
  trash: [746, 728],
};

export function AppIcon({ appId }: { appId: AppId }) {
  if (appId === 'git') return <svg className="app-icon" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><rect x="2" y="2" width="60" height="60" rx="16" fill="#ef714d"/><path d="M22 18v28M42 18v8c0 8-20 5-20 14" fill="none" stroke="#fff3df" strokeWidth="5" strokeLinecap="round"/><circle cx="22" cy="18" r="6" fill="#fff3df"/><circle cx="42" cy="18" r="6" fill="#ffe1a0"/><circle cx="22" cy="46" r="6" fill="#fff3df"/></svg>;
  const [x, y] = positions[appId];
  return <svg className="app-icon" viewBox={`${x} ${y} 302 294`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <image href={artwork} width="1448" height="1086" />
  </svg>;
}
