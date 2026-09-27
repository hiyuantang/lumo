// SPDX-License-Identifier: AGPL-3.0-only
import type { AppId } from '../apps/registry';
import artwork from '../assets/lumo-app-icons.webp';
import '../styles/app-icon.css';

const positions: Record<AppId, [number, number]> = {
  home: [60, 50],
  files: [404, 50],
  preview: [746, 50],
  terminal: [1087, 50],
  opencode: [60, 389],
  containers: [404, 389],
  websites: [746, 389],
  library: [1087, 389],
  skills: [60, 728],
  settings: [404, 728],
  trash: [746, 728],
};

export function AppIcon({ appId }: { appId: AppId }) {
  const [x, y] = positions[appId];
  return <svg className="app-icon" viewBox={`${x} ${y} 302 294`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <image href={artwork} width="1448" height="1086" />
  </svg>;
}
