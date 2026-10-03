// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { getDataSource } from '@lumo/sdk/api/source';
import type { CalendarGoogleStatus } from '@lumo/sdk/api/calendar';
import { AppConfirmation, errorText } from '@lumo/sdk/apps/ServerAppUI';
import { IconRefresh } from '@lumo/sdk/shell/icons';
export function CalendarGoogle({ onChanged }: { onChanged: () => void }) {
  const source = getDataSource();
  const [status, setStatus] = useState<CalendarGoogleStatus | null>(null);
  const [clientId, setClientId] = useState(''), [secret, setSecret] = useState('');
  const [redirect, setRedirect] = useState(`${window.location.origin}/api/v1/calendar/google/callback`);
  const [edit, setEdit] = useState(false), [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const result = new URLSearchParams(window.location.search).get('calendar');
  useEffect(() => { let alive = true; void source.calendarGoogleStatus().then((value) => { if (alive) { setStatus(value); if (value.redirectUri) setRedirect(value.redirectUri); } }).catch((err) => { if (alive) setError(errorText(err)); }); return () => { alive = false; }; }, [source]);
  async function action(kind: 'configure' | 'connect' | 'disconnect') {
    setBusy(true); setError('');
    try {
      const value = await source.calendarGoogle(kind, kind === 'configure' ? { clientId: clientId.trim(), clientSecret: secret.trim(), redirectUri: redirect.trim() } : undefined);
      if (value.url) { const url = new URL(value.url); if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth') throw new Error('Unexpected Google authorization address.'); window.location.assign(url.href); return; }
      setSecret(''); setClientId(''); setEdit(false); setConfirm(false); setStatus(await source.calendarGoogleStatus()); onChanged();
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  return <section className="calendar-google" data-testid="calendar-google">
    <div className="calendar-section-heading"><h2>Google Calendar</h2><button className="btn btn-icon" title="Refresh connection" aria-label="Refresh connection" disabled={busy} onClick={() => { void source.calendarGoogleStatus().then(setStatus).catch((err) => setError(errorText(err))); }}><IconRefresh size={16}/></button></div>
    <p>Connect your Google calendars. Reminders are stored in Lumo.</p>
    {result && <p role="status">{result === 'google-connected' ? 'Google Calendar connected.' : result === 'google-declined' ? 'Google connection was declined.' : 'Google connection did not finish. Try connecting again.'}</p>}
    {error && <p role="alert" className="calendar-error">{error}</p>}
    {status ? <>
      <div className="calendar-account-row"><div><strong>{status.connected ? 'Connected' : status.configured ? 'Ready to connect' : 'Connection setup'}</strong>{status.connected && <span>Your calendar changes sync directly with Google.</span>}</div>{status.connected ? <button className="btn" disabled={busy} onClick={() => setConfirm(true)}>Disconnect</button> : status.configured && !edit ? <button className="btn btn-primary" data-testid="calendar-google-connect" disabled={busy} onClick={() => void action('connect')}>{busy ? 'Connecting…' : 'Connect Google'}</button> : null}</div>
      {(!status.configured || edit) && <form className="calendar-google-form" onSubmit={(e) => { e.preventDefault(); void action('configure'); }}>
        <p className="calendar-hint">Create a Web application OAuth client in Google Cloud, then enter its credentials here. Lumo keeps the secret on your server.</p>
        <label>Client ID<input className="input" aria-label="Google Client ID" value={clientId} maxLength={300} onChange={(e) => setClientId(e.target.value)} autoComplete="off"/></label>
        <label>Client secret<input className="input" aria-label="Google Client secret" type="password" value={secret} maxLength={500} onChange={(e) => setSecret(e.target.value)} autoComplete="off"/></label>
        <label>Callback URL<input className="input" aria-label="Google Callback URL" value={redirect} onChange={(e) => setRedirect(e.target.value)}/></label>
        <p className="calendar-hint">Add this exact URL to the client’s Authorized redirect URIs. Use HTTPS, or localhost during development.</p>
        <div className="calendar-inline-actions"><a className="btn" href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noreferrer">Google Cloud setup</a><button className="btn btn-primary" disabled={busy || !clientId.trim() || !secret.trim()} type="submit">{busy ? 'Saving…' : 'Save setup'}</button>{edit && <button className="btn" type="button" onClick={() => { setSecret(''); setEdit(false); }}>Cancel</button>}</div>
      </form>}
      {status.configured && !status.connected && !edit && <button className="btn" onClick={() => setEdit(true)}>Edit setup</button>}
      <p className="calendar-hint"><a href="https://developers.google.com/identity/protocols/oauth2/web-server" target="_blank" rel="noreferrer">Google’s official OAuth flow</a> authorizes Calendar access. You can revoke it here or in your Google account.</p>
    </> : <p role="status">Loading connection…</p>}
    {confirm && <AppConfirmation title="Disconnect Google Calendar?" confirm="Disconnect" busy={busy} onConfirm={() => void action('disconnect')} onCancel={() => setConfirm(false)}><p>This revokes Lumo’s access. Your Google events remain in Google Calendar.</p></AppConfirmation>}
  </section>;
}
