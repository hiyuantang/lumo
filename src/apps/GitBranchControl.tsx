// SPDX-License-Identifier: AGPL-3.0-only
import { useId, useRef, useState } from 'react';
import type { GitBranch, GitSnapshot } from '../api/git';
import { Popup } from '../shell/Popup';
import { IconBranch, IconChevronDown, IconChevronRight, IconPlus, IconSearch } from '../shell/icons';

export function GitBranchControl({ repo, disabled, onSwitch, onCreate, onMerge }: {
  repo: GitSnapshot; disabled: boolean; onSwitch: (branch: GitBranch) => void; onCreate: () => void; onMerge: (branch: GitBranch) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [query, setQuery] = useState('');
  const [merging, setMerging] = useState(false);
  const branches = repo.branchDetails ?? repo.branches.map((name) => ({ name, ref: `refs/heads/${name}`, default: false } as GitBranch));
  const currentRef = `refs/heads/${repo.branch}`;
  const blocked = Boolean(repo.files.length || repo.operation);
  const visible = branches.filter((branch) => (!merging || branch.ref !== currentRef) && branch.name.toLowerCase().includes(query.toLowerCase()));
  const local = visible.filter((branch) => !branch.remote).sort((a, b) => Number(b.ref === currentRef) - Number(a.ref === currentRef) || Number(b.default) - Number(a.default));
  const remote = visible.filter((branch) => branch.remote);
  function close(restore = false) { setAnchor(null); if (restore) trigger.current?.focus(); }
  function open() { setQuery(''); setMerging(false); setAnchor(trigger.current!.getBoundingClientRect()); }
  function choose(branch: GitBranch) {
    close(true);
    if (merging) onMerge(branch); else if (branch.ref !== currentRef) onSwitch(branch);
  }
  return <>
    <button className="custom-select" ref={trigger} type="button" aria-label="Branch" aria-haspopup="dialog" aria-expanded={Boolean(anchor)} aria-controls={anchor ? id : undefined} data-testid="git-branch" disabled={disabled} onClick={() => anchor ? close() : open()} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); open(); } }}><span>{repo.branch || 'Detached HEAD'}</span><IconChevronDown size={14}/></button>
    {anchor && <Popup x={anchor.left - 24} y={anchor.bottom + 8} above={anchor.top - 8} width={380} anchorElement={trigger.current} keepAnchorVisible onClose={() => close()}>
      <section className="git-branches-panel" id={id} role="dialog" aria-label={merging ? `Merge into ${repo.branch}` : 'Branches'} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !trigger.current?.contains(event.relatedTarget as Node | null)) close(); }} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
        if (event.key === 'Tab') event.stopPropagation();
      }}>
        <header className="git-branches-heading"><strong>{merging ? `Merge into ${repo.branch}` : 'Branches'}</strong>{!merging && <button className="btn" data-testid="git-new-branch" disabled={blocked || disabled || !repo.head} onClick={() => { close(true); onCreate(); }}><IconPlus size={13}/>New branch</button>}</header>
        <label className="app-search git-branch-search"><IconSearch size={14}/><input ref={search} data-autofocus aria-label="Filter branches" placeholder="Filter branches" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); document.getElementById(id)?.querySelector<HTMLButtonElement>('.git-branch-option:not(:disabled)')?.focus(); } }}/></label>
        {blocked && <p className="git-branch-hint">{repo.operation ? 'Finish the active Git operation before changing branches.' : 'Commit or stash changes before switching or merging.'}</p>}
        {merging && <p className="git-branch-hint">Choose the branch to bring into <strong>{repo.branch}</strong>.</p>}
        <div className="git-branch-list" onKeyDown={(event) => {
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
          const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (event.key === 'ArrowUp' && at === 0) { event.preventDefault(); search.current?.focus(); return; }
          const next = event.key === 'ArrowDown' ? Math.min(at + 1, buttons.length - 1) : event.key === 'ArrowUp' ? Math.max(0, at - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
          if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
        }}>
          {[{ title: 'Local branches', items: local }, { title: 'Remote branches', items: remote }].filter((group) => group.items.length).map((group) => <div className="git-branch-group" key={group.title} role="group" aria-label={group.title}>
            <h3>{group.title}</h3>
            {group.items.map((branch) => {
              const current = branch.ref === currentRef;
              const date = branch.date ? new Date(branch.date) : null;
              const validDate = date && !Number.isNaN(date.getTime());
              return <button key={branch.ref} type="button" className="popup-item git-branch-option" aria-label={`${merging ? 'Merge' : 'Switch to'} ${branch.name}`} aria-current={current ? 'true' : undefined} disabled={disabled || (blocked && (!current || merging))} onClick={() => choose(branch)}>
                <span className="git-branch-check" aria-hidden="true">{current ? '✓' : <IconBranch size={15}/>}</span>
                <span className="git-branch-copy"><span className="git-branch-name" title={branch.name}>{branch.name}</span>{(current || branch.upstream || branch.default) && <span className="git-branch-meta">{current ? 'Current branch' : branch.upstream ? `Tracks ${branch.upstream}` : ''}{branch.default && <span className="git-default-badge">Default</span>}</span>}</span>
                {validDate && <time dateTime={branch.date} title={`Last commit: ${date.toLocaleString()}`}>{date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>}
              </button>;
            })}
          </div>)}
          {!visible.length && <p className="git-branch-hint">{query ? 'No branches match your search.' : 'No other branches yet.'}</p>}
        </div>
        <footer className="git-branches-footer"><button className="btn" data-testid="git-merge-choose" disabled={!merging && (blocked || disabled || !repo.branch || !repo.head || branches.length < 2)} onClick={() => { setMerging(!merging); setQuery(''); search.current?.focus(); }}>{merging ? <IconChevronRight size={14}/> : <IconBranch size={14}/>}<span>{merging ? 'Back to branches' : 'Merge a branch…'}</span></button></footer>
      </section>
    </Popup>}
  </>;
}
