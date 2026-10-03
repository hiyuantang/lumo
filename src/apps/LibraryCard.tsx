// SPDX-License-Identifier: AGPL-3.0-only
import { AppIcon } from '../shell/AppIcon';
import type { AppId } from './registry';

export function LibraryCard({ appId, name, status, description, testId, onClick }: { appId: AppId; name: string; status: string; description: string; testId: string; onClick(): void }) {
  return <button type="button" data-testid={testId} className="library-item" onClick={onClick}><span className="library-icon"><AppIcon appId={appId}/></span><span className="library-card-name"><strong>{name}</strong><small>{status}</small></span><span className="library-card-description">{description}</span></button>;
}
