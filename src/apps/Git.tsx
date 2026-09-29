// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { GitAction, GitBranch, GitDiff, GitFile, GitSnapshot } from '../api/git';
import { getDataSource } from '../api/source';
import { useAppPreference, useAppState } from '../shell/useAppState';
import { useShell } from '../shell/ShellContext';
import { useCurrentWindow } from '../shell/WindowContext';
import { useAppMenus } from '../shell/appMenus';
import { IconBranch, IconFolder, IconRefresh, IconSearch, IconUpload, IconDownload } from '../shell/icons';
import { GitRepositoryDialog } from './GitRepositoryDialog';
import { DropdownMenu } from '../shell/DropdownMenu';
import { AppIcon } from '../shell/AppIcon';
import { GitBranchControl } from './GitBranchControl';
import { GitFileStatus } from './GitFileStatus';
import { GitDiffView } from './GitDiffView';
import { FilePicker } from './FilePicker';
import { AppConfirmation, errorText } from './ServerAppUI';
import '../styles/git.css';

const isStaged = (file: GitFile) => file.index !== ' ' && file.index !== '?';
const trackingRemote = (repo: GitSnapshot) => [...repo.remotes].sort((a, b) => b.length - a.length).find((name) => repo.upstream.startsWith(`${name}/`)) ?? '';
const label = (file: GitFile) => file.conflict ? 'Conflict' : file.index === '?' ? 'New' : (file.index + file.worktree).includes('D') ? 'Deleted' : (file.index + file.worktree).includes('R') ? 'Renamed' : file.index === 'A' ? 'Added' : 'Modified';

export function Git() {
  const source = getDataSource();
  const { actions } = useShell();
  const win = useCurrentWindow();
  const [path, setPath] = useAppState<string>('git', 'repository', '');
  const [recent, setRecent] = useAppPreference<string[]>('git', 'recent', []);
  const [repositoryLocation, setRepositoryLocation] = useAppPreference<string[]>('git', 'repository-location', () => [...source.homePath(), 'GitHub']);
  const [tab, setTab] = useAppState<string>('git', 'tab', 'changes', ['changes', 'history']);
  const [repo, setRepo] = useState<GitSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [commit, setCommit] = useState('');
  const [staged, setStaged] = useState(false);
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const [diffError, setDiffError] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [picker, setPicker] = useState(false);
  const [newBranch, setNewBranch] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [remoteChoice, setRemoteChoice] = useState<{ path: string; branch: string; name: string } | null>(null);
  const [repositoryDialog, setRepositoryDialog] = useState<'clone' | 'init' | null>(null);
  const [push, setPush] = useState(false);
  const [merge, setMerge] = useState<GitBranch | null>(null);
  const [abortMerge, setAbortMerge] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const lock = useRef(false);
  const refreshRef = useRef<() => void>(() => {});
  const reload = () => setRefresh((n) => n + 1);
  refreshRef.current = () => { if (!lock.current) reload(); };

  useLayoutEffect(() => actions.registerWindowGuard(win.id, (proceed) => {
    if (lock.current) { setNotice('Wait for the Git operation to finish.'); return; }
    if (summary || description) setPending(() => proceed); else proceed();
  }), [actions, win.id, summary, description]);
  useEffect(() => {
    if (!path) return;
    const onFocus = () => refreshRef.current();
    const timer = window.setInterval(() => { if (!document.hidden && !win.minimized) onFocus(); }, 15000);
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [path, win.minimized]);
  useEffect(() => {
    if (!path) return;
    let alive = true; setLoading(true); setError('');
    void source.gitRepository(path).then((next) => {
      if (!alive) return;
      setRepo(next); setRecent((items) => [next.path, ...items.filter((item) => item !== next.path)].slice(0, 12));
      setSelected((current) => next.files.some((file) => file.path === current) ? current : next.files[0]?.path ?? '');
      setCommit((current) => next.history.some((item) => item.id === current) ? current : next.history[0]?.id ?? '');
    }).catch((err) => { if (alive) setError(errorText(err)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [path, source, refresh]);

  const file = repo?.files.find((item) => item.path === selected);
  const showingStaged = Boolean(file && isStaged(file) && (file.worktree === ' ' || staged));
  useEffect(() => {
    setDiff(null); setDiffError('');
    if (!repo || (tab === 'changes' ? !selected : !commit)) { setDiffLoading(false); return; }
    let alive = true; setDiffLoading(true);
    void source.gitDiff(repo.path, tab === 'changes' ? selected : '', tab === 'history' ? commit : '', showingStaged).then((next) => { if (alive) setDiff(next); }).catch((err) => { if (alive) setDiffError(errorText(err)); }).finally(() => { if (alive) setDiffLoading(false); });
    return () => { alive = false; };
  }, [source, repo?.path, repo?.revision, selected, commit, tab, showingStaged]);

  function open(next: string) {
    const proceed = () => { setSummary(''); setDescription(''); setRepo(null); setSelected(''); setCommit(''); setQuery(''); setNotice(''); setPath(next); reload(); };
    if (summary || description) setPending(() => proceed); else proceed();
  }
  async function run(request: Omit<GitAction, 'path' | 'revision'>) {
    if (!repo || lock.current || loading || (error && request.action !== 'abort-merge')) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await source.gitAction({ ...request, path: repo.path, revision: repo.revision });
      if (request.action === 'commit') { setSummary(''); setDescription(''); setNotice('Commit created.'); }
      else if (request.action === 'fetch') setNotice(`Fetched ${request.remote}.`);
      else if (request.action === 'pull') setNotice('Pull completed.');
      else if (request.action === 'push') setNotice('Push completed.');
      else if (request.action === 'merge') setNotice('Branch merged.');
      else if (request.action === 'abort-merge') setNotice('Merge aborted.');
      setNewBranch(false); setPush(false); setMerge(null); setAbortMerge(false);
      const next = await source.gitRepository(repo.path); setRepo(next);
      setSelected((current) => next.files.some((item) => item.path === current) ? current : next.files[0]?.path ?? '');
      setCommit(next.history[0]?.id ?? '');
    } catch (err) {
      setError(errorText(err));
      if (request.action === 'merge' || request.action === 'abort-merge') { setMerge(null); setAbortMerge(false); await source.gitRepository(repo.path).then(setRepo).catch(() => {}); }
    }
    finally { lock.current = false; setBusy(false); }
  }
  useAppMenus({
    app: [{ id: 'check-updates', label: 'Check for Updates…', run: () => actions.openLibrary('git', true) }],
    file: [{ id: 'clone-repository', label: 'Clone Repository…', disabled: busy, run: () => startRepository('clone') }, { id: 'create-repository', label: 'Create New Repository…', disabled: busy, run: () => startRepository('init') }, { id: 'open-repository', label: 'Add Existing Repository…', disabled: busy, run: () => setPicker(true) }],
    view: [{ id: 'refresh', label: 'Refresh', disabled: busy || !path, run: reload }],
  });
  function startRepository(mode: 'clone' | 'init') {
    const proceed = () => { setSummary(''); setDescription(''); setRepositoryDialog(mode); };
    if (summary || description) setPending(() => proceed); else proceed();
  }
  const remote = repo ? (remoteChoice?.path === repo.path && remoteChoice.branch === repo.branch && repo.remotes.includes(remoteChoice.name) ? remoteChoice.name : trackingRemote(repo) || (repo.remotes.includes('origin') ? 'origin' : repo.remotes[0] ?? '')) : '';
  const remoteBranch = repo && trackingRemote(repo) === remote ? repo.upstream.slice(remote.length + 1) : repo?.branch;
  const disabled = busy || loading || !!error;
  const tracksRemote = !!repo && trackingRemote(repo) === remote;
  const diverged = tracksRemote && !!repo && repo.ahead > 0 && repo.behind > 0;
  const syncAction = repo?.head && repo.branch && (!tracksRemote || repo.ahead > 0) ? 'push' : tracksRemote && repo!.behind > 0 ? 'pull' : 'fetch';
  const syncLabel = !remote ? 'No remote' : syncAction === 'push' && !tracksRemote ? 'Publish branch' : `${syncAction === 'fetch' ? 'Fetch' : syncAction === 'pull' ? 'Pull' : 'Push'} ${remote}`;
  const syncTitle = !remote ? 'Configure a remote in Terminal to sync this repository.' : diverged ? `Push to ${remote}/${remoteBranch}. Git will reject the push until the remote changes are merged.` : syncAction === 'pull' && repo!.files.length > 0 ? 'Commit or stash changes before pulling.' : `${syncAction === 'fetch' ? 'Fetch from' : syncAction === 'pull' ? 'Pull from' : 'Push to'} ${remote}${syncAction === 'fetch' ? '' : `/${remoteBranch}`}`;
  const syncCount = tracksRemote ? syncAction === 'pull' ? repo!.behind : syncAction === 'push' ? repo!.ahead : 0 : 0;
  const stagedCount = repo?.files.filter(isStaged).length ?? 0;
  const conflicts = repo?.files.some((item) => item.conflict);
  const files = repo?.files.filter((item) => item.path.toLowerCase().includes(query.toLowerCase())) ?? [];
  const selectableFiles = files.filter((item) => !item.conflict);
  const selectedCount = selectableFiles.filter(isStaged).length;
  const allSelected = selectableFiles.length > 0 && selectedCount === selectableFiles.length;
  const history = repo?.history.filter((item) => `${item.subject} ${item.author} ${item.id}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  const currentCommit = repo?.history.find((item) => item.id === commit);
  const openFiles = () => { if (repo) actions.openFolder(repo.path.split('/')); };
  return <div className="app git-app" data-testid="app-git">
    <header className={`git-toolbar${repo ? '' : ' is-empty'}`} aria-label="Repository toolbar" data-testid="git-toolbar">
      <div className="git-repository-control">
        <IconFolder size={17}/>
        <DropdownMenu label={repo?.path.split('/').at(-1) || (loading ? 'Opening repository…' : 'No repository open')} ariaLabel="Repository" testId="git-repository" className="git-repository-menu" disabled={busy} items={[
          ...recent.map((item) => ({ label: item.split('/').at(-1) || item, checked: item === repo?.path, run: () => open(item) })),
          { label: 'Clone Repository…', testId: 'git-clone', separator: recent.length > 0, run: () => startRepository('clone') },
          { label: 'Create New Repository…', testId: 'git-create', run: () => startRepository('init') },
          { label: 'Add Existing Repository…', testId: 'git-open', run: () => setPicker(true) },
        ]}/>
      </div>
      {repo && <>
        <div className="git-branch-control">
          <IconBranch size={16}/>
          <GitBranchControl repo={repo} disabled={disabled} onSwitch={(branch) => void run({ action: branch.remote ? 'switch-remote' : 'switch', branch: branch.remote ? branch.ref : branch.name })} onCreate={() => { setBranchName(''); setNewBranch(true); }} onMerge={setMerge}/>
        </div>
        <div className="git-sync" data-testid="git-sync">
          <div className="git-sync-buttons" role="group" aria-label="Sync repository">
            <button className="btn git-sync-primary" data-testid={`git-${syncAction}`} disabled={disabled || !remote || (syncAction !== 'fetch' && (!repo.head || !repo.branch || !!repo.operation)) || (syncAction === 'pull' && repo.files.length > 0)} title={syncTitle} onClick={() => syncAction === 'push' ? setPush(true) : void run({ action: syncAction, remote })}>
              {syncAction === 'fetch' ? <IconRefresh size={14}/> : syncAction === 'pull' ? <IconDownload size={14}/> : <IconUpload size={14}/>}
              <span>{busy ? 'Working…' : syncLabel}</span>{syncCount > 0 && <span className="git-sync-count">{syncCount}</span>}
            </button>
            {remote && (syncAction !== 'fetch' || repo.remotes.length > 1) && <DropdownMenu label="" ariaLabel="Sync options" testId="git-sync-options" disabled={disabled} items={[
              ...(syncAction !== 'fetch' ? [{ label: `Fetch ${remote}`, testId: 'git-fetch-menu', run: () => void run({ action: 'fetch', remote }) }] : []),
              ...(repo.remotes.length > 1 ? repo.remotes.map((name, index) => ({ label: `Use ${name}`, separator: index === 0 && syncAction !== 'fetch', checked: name === remote, run: () => setRemoteChoice({ path: repo.path, branch: repo.branch, name }) })) : []),
            ]}/>}
          </div>
        </div>
      </>}
    </header>
    {error && <div className="git-banner" role="alert"><span>{error}</span><button className="btn" disabled={busy} onClick={reload}>Refresh</button></div>}
    {notice && <p className="git-notice" role="status">{notice}</p>}
    {repo?.operation && <div className="git-banner" role="status"><span>{repo.operation === 'MERGE_HEAD' ? 'Merge needs attention. Resolve and finish it in Terminal, or abort to return to the previous state.' : 'A Git operation is in progress. Complete it in Terminal before committing or syncing.'}</span>{repo.operation === 'MERGE_HEAD' && <button className="btn" disabled={busy || loading} data-testid="git-abort-merge" onClick={() => setAbortMerge(true)}>Abort merge</button>}</div>}
    {!repo ? <main className="git-welcome"><span className="git-welcome-icon"><AppIcon appId="git"/></span><h2>Your repositories, in one place</h2><p>Review changes, make commits and follow your project’s history.</p><button className="btn btn-primary" data-testid="git-choose-folder" onClick={() => setPicker(true)}>Open repository</button>{source.kind === 'mock' && <button className="btn" data-testid="git-demo" onClick={() => open('/home/user/projects/lumo-agent')}>Open demo repository</button>}<small>{loading ? 'Reading repository…' : 'Choose a Git repository on this server.'}</small></main> : <>
      <div className="git-workspace">
        <aside className="git-sidebar" aria-label="Repository changes and history">
          <nav className="git-tabs" aria-label="Repository views">{['changes', 'history'].map((item) => <button type="button" key={item} data-testid={`git-tab-${item}`} aria-current={tab === item ? 'page' : undefined} onClick={() => { setTab(item); setQuery(''); }}>{item === 'changes' ? 'Changes' : 'History'}{item === 'changes' && <span>{repo.files.length}</span>}</button>)}</nav>
          <div className="git-list-tools"><label className="app-search"><IconSearch size={14}/><input aria-label={tab === 'changes' ? 'Filter changed files' : 'Search commits'} placeholder={tab === 'changes' ? 'Filter changed files' : 'Search commits'} value={query} onChange={(e) => setQuery(e.target.value)}/></label><button type="button" className="btn btn-icon" aria-label="Refresh repository" title="Refresh repository" data-testid="git-refresh" disabled={busy || loading} onClick={reload}><IconRefresh size={15}/></button></div>
          {tab === 'changes' && <div className="git-select-all"><input type="checkbox" data-testid="git-stage-all" aria-label={query ? 'Stage all visible files' : 'Stage all files'} ref={(node) => { if (node) node.indeterminate = selectedCount > 0 && !allSelected; }} checked={allSelected} disabled={disabled || !selectableFiles.length} onChange={() => void run({ action: allSelected ? 'unstage' : 'stage', files: selectableFiles.filter((item) => allSelected || !isStaged(item)).map((item) => item.path) })}/><span>{files.length} {query ? 'matching' : 'changed'} {files.length === 1 ? 'file' : 'files'}</span></div>}
          <div className="git-list" aria-busy={loading}>
            {tab === 'changes' ? files.map((item) => <div key={item.path} className={`git-file-row ${selected === item.path ? 'selected' : ''}`}><input type="checkbox" aria-label={`Stage ${item.path}`} data-testid={`git-stage-${item.path}`} checked={isStaged(item)} disabled={disabled || item.conflict} onChange={() => void run({ action: isStaged(item) ? 'unstage' : 'stage', file: item.path })}/><button type="button" aria-pressed={selected === item.path} data-testid={`git-file-${item.path}`} onClick={() => { setSelected(item.path); setStaged(false); }}><span className="git-file-path" title={item.path}>{item.path.includes('/') && <span className="git-file-directory">{item.path.slice(0, item.path.lastIndexOf('/') + 1)}</span>}<span className="git-file-name">{item.path.split('/').at(-1)}</span></span><GitFileStatus status={label(item)}/></button></div>) : history.map((item) => <button className={`git-commit-row ${commit === item.id ? 'selected' : ''}`} key={item.id} data-testid={`git-commit-${item.id}`} aria-pressed={commit === item.id} onClick={() => setCommit(item.id)}><strong>{item.subject}</strong><span>{item.author} · {new Date(item.date).toLocaleDateString()}</span><code>{item.id.slice(0, 7)}</code></button>)}
            {(tab === 'changes' ? !files.length : !history.length) && <p className="git-list-empty">{query ? 'No matches.' : tab === 'changes' ? 'Working tree clean' : 'No commits yet.'}</p>}
          </div>
          {tab === 'changes' && <form className="git-compose" onSubmit={(e) => { e.preventDefault(); void run({ action: 'commit', message: `${summary.trim()}${description.trim() ? `\n\n${description.trim()}` : ''}` }); }}><div className="git-compose-heading"><IconBranch size={16}/><span>{stagedCount} {stagedCount === 1 ? 'file' : 'files'} staged</span></div><input className="input" aria-label="Commit summary" data-testid="git-summary" placeholder="Commit summary" maxLength={200} value={summary} disabled={busy} onChange={(e) => setSummary(e.target.value)}/><textarea className="input" aria-label="Commit description" data-testid="git-description" placeholder="Description (optional)" maxLength={15000} value={description} disabled={busy} onChange={(e) => setDescription(e.target.value)}/><button className="btn btn-primary" data-testid="git-commit" disabled={disabled || !summary.trim() || !stagedCount || conflicts || !!repo.operation} type="submit">{busy ? 'Working…' : `Commit to ${repo.branch || 'detached HEAD'}`}</button></form>}
        </aside>
        <main className="git-detail" aria-label="Git details">
          {(tab === 'changes' && !repo.files.length) || (tab === 'history' && !repo.history.length) ? <div className="git-clean"><span className="git-clean-mark"><IconBranch size={30}/></span><h2>{tab === 'changes' ? 'Everything is up to date locally' : 'Start your project’s history'}</h2><p>{tab === 'changes' ? 'Your working tree is clean. New edits will appear here.' : 'Stage a file and create your first commit in Changes.'}</p><div className="git-clean-actions"><button className="btn" onClick={openFiles}>Open in Files</button><button className="btn" onClick={() => actions.openPi(repo.path)}>Open in Pi</button></div></div> : <>
            <header className="git-detail-header"><div><h2>{tab === 'changes' ? selected : currentCommit?.subject}</h2><p>{tab === 'changes' ? file?.original ? `Renamed from ${file.original}` : `${file ? label(file) : 'Select a file'} · ${showingStaged ? 'Staged for commit' : 'Working changes'}` : `${currentCommit?.author ?? ''} · ${currentCommit ? new Date(currentCommit.date).toLocaleString() : ''}`}</p></div>{tab === 'changes' && file && <div className="git-diff-controls">{isStaged(file) && file.worktree !== ' ' && <button className="btn" onClick={() => setStaged(!staged)} data-testid="git-diff-toggle">{showingStaged ? 'Show working changes' : 'Show staged changes'}</button>}</div>}</header>
            {tab === 'history' && currentCommit?.body && <p className="git-commit-body">{currentCommit.body}</p>}
            <div className="git-diff" tabIndex={0} data-testid="git-diff" aria-busy={diffLoading}>{diffError ? <p role="alert">{diffError}</p> : diffLoading ? <p>Loading diff…</p> : diff?.text ? <GitDiffView text={diff.text}/> : <p>No text changes to display.</p>}{diff?.truncated && <p role="status">Preview truncated. Open the repository in Terminal to see the complete diff.</p>}</div>
          </>}
        </main>
      </div>
      <footer className="git-footer"><button title={repo.path} onClick={openFiles}><IconFolder size={13}/><span>{repo.path}</span></button><span>{busy ? 'Working…' : loading ? 'Refreshing…' : repo.upstream || 'No upstream branch'}</span></footer>
    </>}
    {picker && <FilePicker mode="folder" onCancel={() => setPicker(false)} onOpen={(folder) => { setPicker(false); open(source.absolutePath(folder)); }}/>}
    {repositoryDialog && <GitRepositoryDialog mode={repositoryDialog} initialParent={repositoryLocation} onCancel={() => setRepositoryDialog(null)} onBusy={(value) => { lock.current = value; setBusy(value); }} onCreated={(next, parent) => { setRepositoryLocation(parent); setRepositoryDialog(null); open(next); }}/>}
    {newBranch && <AppConfirmation title="Create branch" confirm="Create branch" busy={busy} confirmDisabled={!branchName.trim() || !!error} onCancel={() => setNewBranch(false)} onConfirm={() => void run({ action: 'create-branch', branch: branchName.trim() })}><p>Create a branch from {repo?.branch || 'the current commit'}.</p><input className="input" aria-label="New branch name" data-testid="git-branch-name" placeholder="feature/my-change" value={branchName} onChange={(e) => setBranchName(e.target.value)}/>{error && <p role="alert">{error}</p>}</AppConfirmation>}
    {merge && <AppConfirmation title={`Merge into ${repo?.branch}?`} confirm="Merge branch" busy={busy} confirmDisabled={!!error} onCancel={() => setMerge(null)} onConfirm={() => void run({ action: 'merge', branch: merge.ref })}><p>Merge <strong>{merge.name}</strong> into <strong>{repo?.branch}</strong>. Git will fast-forward when possible, or create a merge commit. If conflicts occur, you can resolve them in Terminal or abort the merge here.</p></AppConfirmation>}
    {abortMerge && <AppConfirmation title="Abort merge?" confirm="Abort merge" busy={busy} onCancel={() => setAbortMerge(false)} onConfirm={() => void run({ action: 'abort-merge' })}><p>Return to the state before the merge. Any conflict-resolution edits made during this merge will be discarded.</p></AppConfirmation>}
    {push && <AppConfirmation title="Push commits?" confirm="Push" busy={busy} confirmDisabled={!!error} onCancel={() => setPush(false)} onConfirm={() => void run({ action: 'push', remote })}><p>Publish {repo?.branch} to {remote}/{remoteBranch} using this Linux account’s configured credentials.</p>{diverged && <p>The remote has new commits too. Git will reject this push until you merge {repo?.upstream} from the branch menu. Your local commits will be kept.</p>}{error && <p role="alert">{error}</p>}</AppConfirmation>}
    {pending && <AppConfirmation title="Discard commit draft?" confirm="Discard draft" onCancel={() => setPending(null)} onConfirm={() => { const proceed = pending; setPending(null); setSummary(''); setDescription(''); proceed(); }}><p>Your unsubmitted commit message will be discarded. Repository files and staged changes are kept.</p></AppConfirmation>}
  </div>;
}
