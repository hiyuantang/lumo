// SPDX-License-Identifier: AGPL-3.0-only
import { piSettingsSaved } from './pi-settings-notifications';
import { PiSettingToggle } from './PiSettingToggle';
import { useEffect, useState } from 'react';
import type { PiCompaction, PiContextBudget, PiModel } from '@lumo/sdk/api/pi';
import { getDataSource } from '@lumo/sdk/api/source';
import { IconRefresh, IconSearch } from '@lumo/sdk/shell/icons';
import { Select } from '@lumo/sdk/shell/Select';

export function PiCompactionSettings({ model, models, onDirty, onBusy, onSaved, onNotify, revision, applying, running }: { onSaved: () => void; onNotify: (message: string) => void; revision: number; applying: boolean; running: boolean; model?: PiModel; models: PiModel[]; onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void }) {
  const source = getDataSource();
  const catalog = [...new Map([...models, ...(model ? [model] : [])].map((item) => [`${item.provider}/${item.id}`, item])).values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
  const [query, setQuery] = useState('');
  const filtered = catalog.filter((item) => `${item.name} ${item.provider} ${item.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  const [snapshot, setSnapshot] = useState<PiCompaction | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<PiContextBudget['mode']>('percent');
  const [value, setValue] = useState('80');
  const [recent, setRecent] = useState('20000');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [epoch, setEpoch] = useState(0);
  const dirty = !!snapshot && (enabled !== snapshot.enabled || mode !== (snapshot.usageBudget?.mode ?? 'percent') || value !== String(snapshot.usageBudget?.value ?? 80) || recent !== String(snapshot.keepRecentTokens));
  useEffect(() => { onDirty(dirty || saving); return () => onDirty(false); }, [dirty, saving, onDirty]);
  useEffect(() => { onBusy(saving); return () => onBusy(false); }, [saving, onBusy]);
  function populate(settings: PiCompaction) { setSnapshot(settings); setEnabled(settings.enabled); setMode(settings.usageBudget?.mode ?? 'percent'); setValue(String(settings.usageBudget?.value ?? 80)); setRecent(String(settings.keepRecentTokens)); }
  useEffect(() => {
    if (dirty || saving) return;
    let alive = true; setLoading(true); setError(''); setSnapshot(null);
    void source.piCompaction('').then((settings) => { if (alive) populate(settings); }).catch((err) => { if (alive) setError(err instanceof Error ? err.message : 'Could not load compaction settings.'); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [source, epoch, revision]);
  const whole = (input: string) => /^\d+$/.test(input) && Number.isSafeInteger(Number(input));
  const valid = whole(value) && Number(value) >= 1 && (mode !== 'percent' || Number(value) <= 99) && whole(recent);
  const threshold = (capacity: number) => mode === 'percent' ? Math.max(1, Math.floor(capacity * Number(value) / 100)) : Math.min(Number(value), capacity - Math.min(16384, Math.max(1, Math.floor(capacity / 4))));
  async function save() {
    if (!snapshot || !valid || saving) return;
    setSaving(true); setError('');
    try { populate(await source.piSaveCompaction({ model: '', enabled, customized: false, reserveTokens: snapshot.defaultReserveTokens, keepRecentTokens: Number(recent), usageBudget: { mode, value: Number(value) }, revision: snapshot.revision })); onSaved(); onNotify(piSettingsSaved(running)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save compaction settings.'); }
    finally { setSaving(false); }
  }
  return <div className="pi-settings-scroll pi-compaction" data-testid="pi-compaction-settings">
    <section>
      <div className="pi-context-heading"><div><h2>Context &amp; compaction</h2><p>One context budget for all models.</p></div><button className="btn btn-icon" title="Reload compaction settings" aria-label="Reload compaction settings" disabled={dirty || loading || saving || applying} onClick={() => setEpoch((current) => current + 1)}><IconRefresh size={16}/></button></div>
      {loading ? <p role="status">Loading compaction settings…</p> : snapshot && <>
        <PiSettingToggle label="Automatic compaction" description="Summarize older messages when this budget is reached." testId="pi-auto-compaction" checked={enabled} disabled={saving || applying} onChange={setEnabled}/>
        <fieldset className="pi-context-fields" disabled={!enabled || saving || applying}>
          <div className="pi-context-budget-field"><label htmlFor="pi-compact-at"><strong>Compact at</strong></label><div className="pi-context-budget-input"><input id="pi-compact-at" className="input" type="number" min="1" max={mode === 'percent' ? 99 : Number.MAX_SAFE_INTEGER} step="1" data-testid="pi-compaction-usage" value={value} disabled={saving || applying} onChange={(event) => setValue(event.target.value)}/><Select aria-label="Context budget unit" value={mode} disabled={!enabled || saving || applying} options={[{ value: 'percent', label: 'Percentage' }, { value: 'tokens', label: 'Tokens' }]} onChange={(next) => { setMode(next as PiContextBudget['mode']); setValue(next === 'percent' ? '80' : '100000'); }}/></div><small>{mode === 'percent' ? 'Use this percentage of each model’s context window.' : 'Use this many tokens, leaving room for Pi’s response on smaller models.'}</small></div>
          <label><strong>Keep recent tokens</strong><input className="input" type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" aria-label="Keep recent tokens" data-testid="pi-compaction-recent" value={recent} disabled={saving || applying} onChange={(event) => setRecent(event.target.value)}/><small>Keep recent messages without summarizing, capped at the model’s usable budget.</small></label>
        </fieldset>
        {!valid && <p className="pi-settings-error" role="alert">Use a percentage from 1 to 99 or a positive whole token count. Recent tokens must be a non-negative whole number.</p>}
        {!snapshot.usageBudget && <p>Pi’s existing budgets are active. Save to apply this shared budget to all models.</p>}
        <div className="pi-settings-actions"><span role="status">{applying ? 'Applying when Pi is idle…' : dirty ? 'Unsaved changes' : ''}</span>{dirty && <button className="btn" disabled={saving || applying} onClick={() => { populate(snapshot); setError(''); }}>Cancel</button>}<button className="btn btn-primary" data-testid="pi-compaction-save" disabled={(!dirty && !!snapshot.usageBudget) || saving || applying || !valid} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button></div>
      </>}
      {error && <p className="pi-settings-error" role="alert">{error}</p>}
    </section>
    <section>
      <h2>Model context windows</h2><p>Capacities reported by Pi. Compaction points below preview the settings above.</p>
      <div className="pi-context-catalog" data-testid="pi-context-catalog">
        <label className="app-search"><IconSearch size={15}/><input type="search" aria-label="Search model context windows" placeholder="Search models or providers…" value={query} onChange={(event) => setQuery(event.target.value)}/></label>
        <div className="pi-context-catalog-list" tabIndex={0} aria-label="Model context windows">
          {filtered.map((item) => <div className="pi-context-catalog-row" key={`${item.provider}/${item.id}`}><span><strong>{item.name}</strong><small title={`${item.provider}/${item.id}`}>{item.provider} · {item.id}</small></span><span className="pi-context-catalog-limit">{item.contextWindow ? `${item.contextWindow.toLocaleString()} tokens max` : 'Maximum not reported'}<small>{!enabled ? 'Auto compaction off' : valid && item.contextWindow && item.contextWindow >= 2 ? `Compact at ${threshold(item.contextWindow).toLocaleString()} (${Math.round(threshold(item.contextWindow) / item.contextWindow * 100)}%)` : 'Compaction point unavailable'}</small></span></div>)}
          {!filtered.length && <p>{catalog.length ? 'No matching models.' : 'No models available. Connect a provider to load its models.'}</p>}
        </div>
      </div>
    </section>
  </div>;
}
