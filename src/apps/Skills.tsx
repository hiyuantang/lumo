// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { describeError, getDataSource } from '../api/source';
import type { SkillCatalog, SkillDetail } from '../api/skills';
import { IconRefresh, IconSearch, IconSkills } from '../shell/icons';
import { useAppState } from '../shell/useAppState';
import { Markdown } from './Markdown';
import '../styles/preview.css';
import '../styles/skills.css';

export function Skills() {
  const [catalog, setCatalog] = useState<SkillCatalog | null>(null);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useAppState<string>('skills', 'selection', '');
  const [search, setSearch] = useAppState<string>('skills', 'search', '');
  const [mode, setMode] = useAppState<'read' | 'raw'>('skills', 'mode', 'read', ['read', 'raw']);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    void getDataSource().listSkills().then((next) => { if (active) setCatalog(next); }).catch((err) => { if (active) setError(describeError(err)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
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
  return <div className="app skills" data-testid="app-skills"><div className="skills-layout">
    <aside className="skills-sidebar" aria-label="Skills library">
      <header className="skills-heading"><div><IconSkills size={21}/><h2>My skills</h2></div><button type="button" className="btn" aria-label="Refresh skills" title="Refresh skills" data-testid="skills-refresh" disabled={loading} onClick={() => setRevision((value) => value + 1)}><IconRefresh size={15}/></button></header>
      <label className="skills-search"><IconSearch size={15}/><input type="search" aria-label="Search skills" placeholder="Search skills" value={search} onChange={(event) => setSearch(event.target.value)}/></label>
      <span className="skills-count" aria-live="polite">{loading ? 'Scanning…' : `${filtered.length} ${filtered.length === 1 ? 'skill' : 'skills'}`}</span>
      <nav className="skills-list" aria-label="Installed skills">{filtered.map((skill) => <button type="button" key={skill.id} aria-current={current?.id === skill.id ? 'page' : undefined} data-testid={`skill-${skill.id}`} onClick={() => setSelected(skill.id)}><strong>{skill.name}</strong><span>{skill.description || skill.issue || 'No description'}</span>{skill.issue && <small>Needs attention</small>}</button>)}</nav>
      <footer className="skills-location"><span>Account skills</span><code title={catalog?.path}>~/.agents/skills</code></footer>
    </aside>
    <main className="skills-detail" aria-busy={loading}>
      {error && <p className="skills-notice" role="alert">{error} Use Refresh to try again.</p>}
      {catalog?.limited && <p className="skills-notice" role="status">Only the first 512 folder entries were checked.</p>}
      {current ? <>
        <header className="skills-hero"><span className="skills-emblem"><IconSkills size={30}/></span><div><span className="skills-eyebrow">ACCOUNT SKILL</span><h1>{current.name}</h1><p>{current.description}</p></div></header>
        <div className="skills-document-heading"><h2>Instructions</h2><div className="preview-modes" role="group" aria-label="Skill view"><button className="btn" type="button" aria-pressed={mode === 'read'} onClick={() => setMode('read')}>Read</button><button className="btn" type="button" aria-pressed={mode === 'raw'} onClick={() => setMode('raw')}>Raw</button></div></div>
        {issue && <p className="skills-notice" role="status">{issue}</p>}
        {detailError ? <p className="skills-notice" role="alert">{detailError} Refresh to check this skill again.</p> : !detail ? <p className="skills-status" role="status">Loading instructions…</p> : <div className="skills-document" data-testid="skill-document">{mode === 'raw' ? <pre>{detail.raw || 'No text available.'}</pre> : detail.body ? <Markdown text={detail.body}/> : <p className="skills-status">No instructions to display.</p>}</div>}
        <footer className="skills-file-path" title={current.path}>{current.path}</footer>
      </> : <div className="skills-empty"><IconSkills size={48}/><h1>{loading ? 'Loading your skills…' : query ? 'No matching skills' : error ? 'Skills unavailable' : 'Your skills, in one place'}</h1><p>{loading ? 'Reading your account skills folder.' : query ? 'Try a different name or description.' : error ? 'Check folder access, then refresh.' : <>Add a folder containing <code>SKILL.md</code> to <code>~/.agents/skills</code>, then refresh to see it here.</>}</p>{query && <button className="btn" type="button" onClick={() => setSearch('')}>Clear search</button>}</div>}
    </main>
  </div></div>;
}
