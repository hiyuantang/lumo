// SPDX-License-Identifier: AGPL-3.0-only
import { useAppMenus } from '../shell/appMenus';
import { useEffect, useState } from 'react';
import { describeError, getDataSource } from '../api/source';
import type { SkillCatalog, SkillDetail } from '../api/skills';
import { IconRefresh, IconSearch, IconSkills } from '../shell/icons';
import { useContextMenu } from '../shell/ContextMenu';
import { useShell } from '../shell/ShellContext';
import { copyText } from '../utils/clipboard';
import { useAppState } from '../shell/useAppState';
import { Markdown } from './Markdown';
import '../styles/preview.css';
import '../styles/skills.css';

export function Skills() {
  const openContextMenu = useContextMenu();
  const { actions, state } = useShell();
  const [catalog, setCatalog] = useState<SkillCatalog | null>(null);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useAppState<string>('skills', 'selection', '');
  const [search, setSearch] = useAppState<string>('skills', 'search', '');
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    void getDataSource().listSkills().then((next) => { if (active) setCatalog(next); }).catch((err) => { if (active) setError(describeError(err)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision, state.fileRevision]);
  const query = search.trim().toLowerCase();
  const filtered = catalog?.skills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(query)) ?? [];
  const current = filtered.find((skill) => skill.id === selected) ?? filtered[0];
  useEffect(() => {
    let active = true;
    setDetail(null); setDetailError(null);
    if (current) void getDataSource().readSkill(current.id).then((next) => { if (active) setDetail(next); }).catch((err) => { if (active) setDetailError(describeError(err)); });
    return () => { active = false; };
  }, [current?.id, catalog]);
  const issue = detail?.issue ?? current?.issue;
  const document = skillDocument(detail?.id === current?.id ? detail?.body ?? '' : '', current?.name ?? '');
  function edit() { if (current) actions.openPreview(current.path.split('/'), true); }
  useAppMenus({
    file: [{ id: 'edit', label: 'Edit in Preview', disabled: !current, run: edit }],
    view: [
      { id: 'refresh', label: 'Refresh', disabled: loading, run: () => setRevision((value) => value + 1) },
    ],
  });

  return <div className="app skills" data-testid="app-skills"><div className="skills-layout">
    <aside className="skills-sidebar" aria-label="Skills library">
      <header className="skills-heading"><div><IconSkills size={21}/><h2>My skills</h2></div><button type="button" className="btn btn-icon" aria-label="Refresh skills" title="Refresh skills" data-testid="skills-refresh" disabled={loading} onClick={() => setRevision((value) => value + 1)}><IconRefresh size={16}/></button></header>
      <label className="app-search skills-search"><IconSearch size={15}/><input type="search" aria-label="Search skills" placeholder="Search skills" value={search} onChange={(event) => setSearch(event.target.value)}/></label>
      <span className="skills-count" aria-live="polite">{loading ? 'Scanning…' : `${filtered.length} ${filtered.length === 1 ? 'skill' : 'skills'}`}</span>
      <nav className="skills-list" aria-label="Installed skills">{filtered.map((skill) => <button type="button" key={skill.id} aria-current={current?.id === skill.id ? 'page' : undefined} data-testid={`skill-${skill.id}`} onClick={() => setSelected(skill.id)} onContextMenu={(event) => openContextMenu(event, [
        { label: 'Edit in Preview', run: () => actions.openPreview(skill.path.split('/'), true) },
        { label: 'Reveal in Files', run: () => actions.openFolder(skill.path.split('/').slice(0, -1)) },
        { label: 'Copy Path', separator: true, run: () => { void copyText(skill.path).catch(() => actions.notify('Clipboard unavailable', 'Could not copy the skill path.')); } },
      ])}><strong>{skill.name}</strong><span>{skill.description || skill.issue || 'No description'}</span>{skill.issue && <small>Needs attention</small>}</button>)}</nav>
      <footer className="skills-location"><span>Account skills</span><code title={catalog?.path}>~/.agents/skills</code></footer>
    </aside>
    <main className="skills-detail" aria-busy={loading}>
      {error && <p className="skills-notice" role="alert">{error} Use Refresh to try again.</p>}
      {catalog?.limited && <p className="skills-notice" role="status">Only the first 512 folder entries were checked.</p>}
      {current ? <>
        <header className="skills-hero"><span className="skills-emblem"><IconSkills size={30}/></span><div><h1>{document.title}</h1><p>{current.description}</p></div><button className="btn" type="button" data-testid="skill-edit" onClick={edit}>Edit</button></header>
        {issue && <p className="skills-notice" role="status">{issue}</p>}
        {detailError ? <p className="skills-notice" role="alert">{detailError} Refresh to check this skill again.</p> : !detail ? <p className="skills-status" role="status">Loading instructions…</p> : <div className="skills-document" data-testid="skill-document">{document.body ? <Markdown text={document.body}/> : <p className="skills-status">No instructions to display.</p>}</div>}
      </> : <div className="skills-empty"><IconSkills size={48}/><h1>{loading ? 'Loading your skills…' : query ? 'No matching skills' : error ? 'Skills unavailable' : 'Your skills, in one place'}</h1><p>{loading ? 'Reading your account skills folder.' : query ? 'Try a different name or description.' : error ? 'Check folder access, then refresh.' : <>Add a folder containing <code>SKILL.md</code> to <code>~/.agents/skills</code>, then refresh to see it here.</>}</p>{query && <button className="btn" type="button" onClick={() => setSearch('')}>Clear search</button>}</div>}
    </main>
  </div></div>;
}

function skillDocument(body: string, name: string): { title: string; body: string } {
  const heading = body.match(/^\s*#(?!#)[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)/);
  if (heading) return { title: heading[1], body: body.slice(heading[0].length).trimStart() };
  const underlined = body.match(/^\s*([^\r\n]+)\r?\n[ \t]*={3,}[ \t]*(?:\r?\n|$)/);
  if (underlined) return { title: underlined[1].trim(), body: body.slice(underlined[0].length).trimStart() };
  return { title: name, body };
}
