// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { describeError } from '../api/source';
import { useAppCatalog } from '../shell/AppCatalogContext';
import { useAppState } from '../shell/useAppState';
import { useShell } from '../shell/ShellContext';
import { useCurrentWindow } from '../shell/WindowContext';
import { TerminalWorkspace } from './Terminal';

export function OpenCode() {
  const { actions } = useShell();
  const win = useCurrentWindow();
  const { catalog, refresh } = useAppCatalog();
  const installed = catalog?.apps.some((app) => app.id === 'opencode' && app.installed);
  const [project, setProject] = useAppState<string>('opencode', 'project', '~');
  const [running, setRunning] = useState<string | null>(win.projectPath ?? null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function check() {
    setChecking(true); setError(null);
    try { await refresh(); } catch (err) { setError(describeError(err)); }
    finally { setChecking(false); }
  }

  return <div className="app opencode" data-testid="app-opencode">
    {running !== null && installed ? <>
      <TerminalWorkspace program="opencode" directory={running} />
    </> : <div className="opencode-launcher">
      <h1>OpenCode</h1><p>Your coding agent, running in a terminal on this server.</p>
      {installed ? <form onSubmit={(event) => {
        event.preventDefault();
        const path = project.trim() || '~';
        if (path !== '~' && !path.startsWith('/')) { setError('Use an absolute folder path, or ~ for your home folder.'); return; }
        setError(null); setProject(path); setRunning(path); actions.setOpenCodeProject(win.id, path);
      }}>
        <label htmlFor={`opencode-project-${win.id}`}>Project folder</label>
        <input id={`opencode-project-${win.id}`} className="input mono" data-testid="opencode-project" value={project} onChange={(event) => setProject(event.target.value)} placeholder="/home/you/project" />
        <p>Provider sign-in, model selection and approval prompts appear inside OpenCode.</p>
        <button type="submit" className="btn btn-primary" data-testid="opencode-start">Open project</button>
      </form> : <>
        <p>{catalog ? 'Install the OpenCode CLI for your Linux account, then check again.' : 'Checking for OpenCode…'}</p>
        <div className="opencode-actions"><a className="btn" href="https://opencode.ai/docs/" target="_blank" rel="noreferrer">Installation guide</a><button className="btn" type="button" onClick={() => actions.openApp('terminal')}>Open Terminal</button><button className="btn btn-primary" type="button" disabled={checking} onClick={() => void check()}>{checking ? 'Checking…' : 'Check again'}</button></div>
      </>}
      {error && <p role="alert">{error}</p>}
    </div>}
  </div>;
}
