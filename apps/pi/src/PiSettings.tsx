// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import type { PiExtensionSettings } from '@lumo/sdk/api/lumo-use';
import type { PiModel } from '@lumo/sdk/api/pi';
import { IconArchive, IconGear, IconFile, IconUser, IconPet } from '@lumo/sdk/shell/icons';
import { PiInstructionEditor } from './PiInstructionEditor';
import { PiProviders } from './PiProviders';
import { PiCompactionSettings } from './PiCompactionSettings';
import { PiSettingToggle } from './PiSettingToggle';
import { PiExtensions } from './PiExtensions';
import { PiTemplateSettings } from './PiTemplateSettings';
import { PiArchivedChats } from './PiArchivedChats';
import { PiEngine } from './PiEngine';
import { PiPetSettings } from './PiPetSettings';

interface Props {
  requestedTab?: { tab: 'pet'; nonce: number };
  onNotify: (message: string) => void;
  autoRetry: boolean;
  onAutoRetry: (value: boolean) => void;
  onTemplatesSaved: () => void;
  onExtensionsSaved: (settings: PiExtensionSettings) => void;
  extensionsApplying: boolean;
  extensionsRunning: boolean;
  onCompactionSaved: () => void;
  compactionRevision: number;
  compactionPending: boolean;
  installed: boolean;
  visible: boolean;
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
export function PiSettings({ requestedTab, onNotify, autoRetry, onAutoRetry, onTemplatesSaved, onExtensionsSaved, extensionsApplying, extensionsRunning, onCompactionSaved, compactionRevision, compactionPending, installed, visible, model, models, setup, disabled, onBusy, revision, onConnect, onDone, onDirty, onRestore }: Props) {
  const [tab, setTab] = useState<'providers' | 'instructions' | 'context' | 'archived' | 'templates' | 'extensions' | 'pet' | 'engine'>('providers');
  const [extensionsVisited, setExtensionsVisited] = useState(false);
  const [extensionsBusy, setExtensionsBusy] = useState(false);
  const [contextVisited, setContextVisited] = useState(false);
  const [contextDirty, setContextDirty] = useState(false);
  const [contextBusy, setContextBusy] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [instructionsDirty, setInstructionsDirty] = useState(false);
  const [appendDirty, setAppendDirty] = useState(false);
  const [instructionsBusy, setInstructionsBusy] = useState(false);
  const [appendBusy, setAppendBusy] = useState(false);
  const [providerDirty, setProviderDirty] = useState(false);
  const [templateDirty, setTemplateDirty] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const saving = instructionsBusy || appendBusy || templateBusy || extensionsBusy;
  useEffect(() => { onBusy(saving || archiveBusy || contextBusy); return () => onBusy(false); }, [saving, archiveBusy, contextBusy, onBusy]);
  useEffect(() => { onDirty(templateDirty || instructionsDirty || appendDirty || saving || providerDirty || archiveBusy || contextDirty || contextBusy); return () => onDirty(false); }, [templateDirty, instructionsDirty, appendDirty, saving, providerDirty, archiveBusy, contextDirty, contextBusy, onDirty]);
  const requestedNonce = useRef<number>();
  useEffect(() => {
    if (!requestedTab || requestedTab.nonce === requestedNonce.current || templateDirty || saving || archiveBusy || contextBusy || setup) return;
    requestedNonce.current = requestedTab.nonce;
    setTab(requestedTab.tab);
  }, [requestedTab, templateDirty, saving, archiveBusy, contextBusy, setup]);
  const tabs = [{ id: 'engine' as const, label: 'Engine', icon: IconGear }, { id: 'providers' as const, label: 'Providers', icon: IconUser }, { id: 'instructions' as const, label: 'Instructions', icon: IconFile }, { id: 'templates' as const, label: 'Prompt templates', icon: IconFile }, { id: 'context' as const, label: 'Context & compaction', icon: IconGear }, { id: 'extensions' as const, label: 'Extensions', icon: IconGear }, { id: 'pet' as const, label: 'Pet', icon: IconPet }, { id: 'archived' as const, label: 'Archived chats', icon: IconArchive }];
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
      }}>{tabs.map(({ id, label, icon: Icon }) => <button type="button" key={id} role="tab" id={`pi-settings-tab-${id}`} aria-controls={`pi-settings-panel-${id}`} aria-label={label} title={label} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} disabled={archiveBusy || saving || contextBusy || setup || (templateDirty && id !== tab)} onClick={() => { if (templateDirty && id !== 'templates') return; setTab(id); if (id === 'context') setContextVisited(true); if (id === 'extensions') setExtensionsVisited(true); }}><Icon size={18}/><span>{label}</span></button>)}</div>
    </aside>
    <div className="pi-settings-content">
      {tab === 'engine' && <div className="pi-settings-pane" id="pi-settings-panel-engine" role="tabpanel" aria-labelledby="pi-settings-tab-engine"><PiEngine disabled={extensionsRunning}/></div>}
      <div className="pi-settings-pane" id="pi-settings-panel-providers" role="tabpanel" aria-labelledby="pi-settings-tab-providers" hidden={tab !== 'providers'}>
        {setup ? <><div className="pi-provider-done"><button className="btn" onClick={onDone}>Done</button></div><PiProviders onDirty={setProviderDirty} onNotify={onNotify}/></> : <PiProviders overview visible={visible && tab === 'providers'} disabled={!installed || disabled || saving} onConnect={onConnect} onDirty={setProviderDirty} onNotify={onNotify}><section data-testid="pi-retry-settings"><PiSettingToggle label="Automatic retry" description="Retry temporary provider errors in this chat." ariaLabel="Automatically retry temporary errors" testId="pi-auto-retry" checked={autoRetry} disabled={!installed || disabled} onChange={onAutoRetry}/></section></PiProviders>}
      </div>
      <div className="pi-settings-pane" id="pi-settings-panel-instructions" role="tabpanel" aria-labelledby="pi-settings-tab-instructions" hidden={tab !== 'instructions'}>
        <div className="pi-settings-scroll pi-instruction-sections">
          <PiInstructionEditor kind="instructions" onDirty={setInstructionsDirty} onBusy={setInstructionsBusy} onNotify={onNotify}/>
          <PiInstructionEditor kind="append" onDirty={setAppendDirty} onBusy={setAppendBusy} onNotify={onNotify}/>
        </div>
      </div>
      <div className="pi-settings-pane" id="pi-settings-panel-templates" role="tabpanel" aria-labelledby="pi-settings-tab-templates" hidden={tab !== 'templates'}>{tab === 'templates' && <PiTemplateSettings onDirty={setTemplateDirty} onBusy={setTemplateBusy} onSaved={onTemplatesSaved} onNotify={onNotify}/>}</div>
      {contextVisited && <div className="pi-settings-pane" id="pi-settings-panel-context" role="tabpanel" aria-labelledby="pi-settings-tab-context" hidden={tab !== 'context'}><PiCompactionSettings onSaved={onCompactionSaved} revision={compactionRevision} applying={compactionPending} running={extensionsRunning} model={model} models={models} onDirty={setContextDirty} onBusy={setContextBusy} onNotify={onNotify}/></div>}
      {extensionsVisited && <div className="pi-settings-pane" id="pi-settings-panel-extensions" role="tabpanel" aria-labelledby="pi-settings-tab-extensions" hidden={tab !== 'extensions'}><PiExtensions onBusy={setExtensionsBusy} onNotify={onNotify} onSaved={onExtensionsSaved} applying={extensionsApplying} running={extensionsRunning}/></div>}
      {tab === 'pet' && <div className="pi-settings-pane" id="pi-settings-panel-pet" role="tabpanel" aria-labelledby="pi-settings-tab-pet"><PiPetSettings/></div>}
      {tab === 'archived'    && <div className="pi-settings-pane" id="pi-settings-panel-archived" role="tabpanel" aria-labelledby="pi-settings-tab-archived"><PiArchivedChats revision={revision} disabled={disabled} onRestore={onRestore} onBusy={setArchiveBusy}/></div>}
    </div>
  </main>;
}
