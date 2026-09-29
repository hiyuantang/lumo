// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import type { PiModel } from '../api/pi';
import { IconArchive, IconGear, IconFile, IconUser } from '../shell/icons';
import { PiInstructionEditor } from './PiInstructionEditor';
import { PiProviders } from './PiProviders';
import { PiCompactionSettings } from './PiCompactionSettings';
import { PiArchivedChats } from './PiArchivedChats';

interface Props {
  onCompactionSaved: () => void;
  compactionRevision: number;
  compactionPending: boolean;
  installed: boolean;
  provider?: string;
  model?: PiModel;
  models: PiModel[];
  setup: boolean;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  revision: number;
  onConnect: () => void;
  onDone: () => void;
  onDirty: (dirty: boolean) => void;
  onRestore: (project: string, session: string) => Promise<void>;
}
export function PiSettings({ onCompactionSaved, compactionRevision, compactionPending, installed, provider, model, models, setup, disabled, onBusy, revision, onConnect, onDone, onDirty, onRestore }: Props) {
  const [tab, setTab] = useState<'providers' | 'instructions' | 'context' | 'archived'>('providers');
  const [contextVisited, setContextVisited] = useState(false);
  const [contextDirty, setContextDirty] = useState(false);
  const [contextBusy, setContextBusy] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [instructionsDirty, setInstructionsDirty] = useState(false);
  const [appendDirty, setAppendDirty] = useState(false);
  const [instructionsBusy, setInstructionsBusy] = useState(false);
  const [appendBusy, setAppendBusy] = useState(false);
  const [providerDirty, setProviderDirty] = useState(false);
  const saving = instructionsBusy || appendBusy;
  useEffect(() => { onBusy(saving || archiveBusy || contextBusy); return () => onBusy(false); }, [saving, archiveBusy, contextBusy, onBusy]);
  useEffect(() => { onDirty(instructionsDirty || appendDirty || saving || providerDirty || archiveBusy || contextDirty || contextBusy); return () => onDirty(false); }, [instructionsDirty, appendDirty, saving, providerDirty, archiveBusy, contextDirty, contextBusy, onDirty]);
  const tabs = [{ id: 'providers' as const, label: 'Providers', icon: IconUser }, { id: 'instructions' as const, label: 'Instructions', icon: IconFile }, { id: 'context' as const, label: 'Context & compaction', icon: IconGear }, { id: 'archived' as const, label: 'Archived chats', icon: IconArchive }];
  return <main className="pi-main pi-settings" data-testid="pi-settings">
    <aside className="pi-settings-card">
      <h1>Settings</h1>
      <div className="pi-settings-nav" role="tablist" aria-label="Pi settings tabs" aria-orientation="vertical" onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (!buttons.length) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].focus(); buttons[next].click();
      }}>{tabs.map(({ id, label, icon: Icon }) => <button type="button" key={id} role="tab" id={`pi-settings-tab-${id}`} aria-controls={`pi-settings-panel-${id}`} aria-label={label} title={label} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} disabled={archiveBusy || saving || contextBusy || setup} onClick={() => { setTab(id); if (id === 'context') setContextVisited(true); }}><Icon size={18}/><span>{label}</span></button>)}</div>
    </aside>
    <div className="pi-settings-content">
      <div className="pi-settings-pane" id="pi-settings-panel-providers" role="tabpanel" aria-labelledby="pi-settings-tab-providers" hidden={tab !== 'providers'}>
        {setup ? <><div className="pi-provider-done"><button className="btn" onClick={onDone}>Done</button></div><PiProviders onDirty={setProviderDirty}/></> : <div className="pi-settings-scroll"><section className="pi-settings-provider">
          <div><h2>Providers</h2><p>{provider ? `Current provider: ${provider}` : 'Manage accounts and API keys.'}</p></div>
          <button className="btn" disabled={!installed || disabled || saving} onClick={onConnect}>Connect provider</button>
        </section></div>}
      </div>
      <div className="pi-settings-pane" id="pi-settings-panel-instructions" role="tabpanel" aria-labelledby="pi-settings-tab-instructions" hidden={tab !== 'instructions'}>
        <div className="pi-settings-scroll pi-instruction-sections">
          <PiInstructionEditor kind="instructions" onDirty={setInstructionsDirty} onBusy={setInstructionsBusy}/>
          <PiInstructionEditor kind="append" onDirty={setAppendDirty} onBusy={setAppendBusy}/>
        </div>
      </div>
      {contextVisited && <div className="pi-settings-pane" id="pi-settings-panel-context" role="tabpanel" aria-labelledby="pi-settings-tab-context" hidden={tab !== 'context'}><PiCompactionSettings onSaved={onCompactionSaved} revision={compactionRevision} applying={compactionPending} model={model} models={models} onDirty={setContextDirty} onBusy={setContextBusy}/></div>}
      {tab === 'archived'  && <div className="pi-settings-pane" id="pi-settings-panel-archived" role="tabpanel" aria-labelledby="pi-settings-tab-archived"><PiArchivedChats revision={revision} disabled={disabled} onRestore={onRestore} onBusy={setArchiveBusy}/></div>}
    </div>
  </main>;
}
