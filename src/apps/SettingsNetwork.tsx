// SPDX-License-Identifier: AGPL-3.0-only
import { useAppMenus } from '../shell/appMenus';
import { useEffect, useState } from 'react';
import { describeError, getDataSource, type NetworkInterface, type NetworkSnapshot } from '../api/source';
import { copyText } from '../utils/clipboard';
import '../styles/apps.css';
import '../styles/network.css';

function preferredInterface(interfaces: NetworkInterface[]): NetworkInterface | undefined {
  return interfaces.find((item) => item.up && !item.loopback && item.addresses.length > 0) ?? interfaces.find((item) => !item.loopback) ?? interfaces[0];
}

export function SettingsNetwork({ active = true }: { active?: boolean }) {
  const source = getDataSource();
  const [snapshot, setSnapshot] = useState<NetworkSnapshot | null>(null);
  const [selectedName, setSelectedName] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    source.getNetworkSnapshot().then((next) => {
      if (!active) return;
      setSnapshot(next);
      setSelectedName((current) => next.interfaces.some((item) => item.name === current) ? current : preferredInterface(next.interfaces)?.name ?? '');
    }).catch((err) => {
      if (active) setError(describeError(err));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [source, refresh]);

  const selected = snapshot?.interfaces.find((item) => item.name === selectedName);
  const dns = selected?.dnsServers?.length ? selected.dnsServers : snapshot?.dnsServers;
  const dnsLabel = selected?.dnsServers?.length ? 'Interface DNS servers' : 'System DNS servers';
  const details = selected ? [
    { id: 'ipv4', label: 'IPv4 addresses', values: selected.addresses.filter((value) => !value.includes(':')), empty: 'None assigned' },
    { id: 'ipv6', label: 'IPv6 addresses', values: selected.addresses.filter((value) => value.includes(':')), empty: 'None assigned' },
    { id: 'gateway', label: 'Default gateways', values: selected.gateways, empty: 'None reported' },
    { id: 'dns', label: dnsLabel, values: dns, empty: 'None reported' },
    { id: 'mac', label: 'MAC address', values: selected.hardwareAddress ? [selected.hardwareAddress] : [], empty: 'Not reported' },
  ] : [];

  async function copy(label: string, value: string) {
    try {
      await copyText(value);
      setCopyStatus(`${label} copied.`);
    } catch {
      setCopyStatus('Could not copy. Select the text and copy it manually.');
    }
  }

  useAppMenus({ view: active ? [{ id: 'refresh', label: 'Refresh', disabled: loading, run: () => { setCopyStatus(''); setRefresh((value) => value + 1); } }] : [] });

  return (
    <div className="settings-network" data-testid="app-network">
      <header className="settings-heading">
        <div><h2>Network</h2></div>
        <button type="button" className="btn" data-testid="network-refresh" disabled={loading} onClick={() => { setCopyStatus(''); setRefresh((value) => value + 1); }}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </header>
      <p className="network-note">Manage network settings through SSH or your server’s network tools.</p>
      {error ? <p className="network-error" role="alert">Could not refresh network details. {error}{snapshot ? ' Showing the last available information.' : ''}</p> : null}
      {snapshot && snapshot.interfaces.length > 0 ? <section className="network-interfaces" aria-label="Network interfaces">
        <h3>Interfaces</h3>
        <div className="network-interface-list">
          {snapshot.interfaces.map((item) => (
            <button type="button" className={`network-interface ${item.name === selectedName ? 'selected' : ''}`} data-testid={`network-interface-${item.name}`} aria-current={item.name === selectedName ? 'page' : undefined} key={item.name} onClick={() => { setSelectedName(item.name); setCopyStatus(''); }}>
              <span className={`network-status ${item.up ? 'up' : ''}`} aria-hidden="true" />
              <span><strong>{item.name}</strong><small>{item.loopback ? 'Loopback' : item.up ? 'Up' : 'Down'}</small></span>
            </button>
          ))}
        </div>
      </section> : null}
      {selected ? <section className="network-content" aria-label="Interface details" data-testid="network-details">
        <header className="network-heading">
          <h3>{selected.name}</h3>
          <span className={`network-state ${selected.up ? 'up' : ''}`}>{selected.up ? 'Up' : 'Down'}</span>
        </header>
        <dl className="network-details">
          {details.map(({ id, label, values, empty }) => <div className="network-detail" key={id} data-testid={`network-detail-${id}`}>
            <dt>{label}</dt>
            <dd>{values?.length ? values.map((value) => <div className="network-value" key={value}>
              <span className="mono">{value}</span>
              <button type="button" className="btn" data-testid={`network-copy-${id}-${value}`} aria-label={`Copy ${value}`} onClick={() => void copy(label, id === 'ipv4' || id === 'ipv6' ? value.split('/')[0] : value)}>Copy</button>
            </div>) : <span className="network-unavailable">{values ? empty : 'Unavailable'}</span>}</dd>
          </div>)}
        </dl>
        {snapshot?.dnsSource === 'resolv.conf' && !selected.dnsServers?.length ? <p className="network-note">System DNS is reported by the server’s resolver configuration and may use a local resolver.</p> : null}
      </section> : loading ? <p className="network-empty" role="status">Loading network details…</p> : !error ? <p className="network-empty">No network interfaces found.</p> : null}
      <p className="network-copy-status" role="status" aria-live="polite">{copyStatus}</p>
    </div>
  );
}
