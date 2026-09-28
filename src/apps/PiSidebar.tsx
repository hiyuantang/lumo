// SPDX-License-Identifier: AGPL-3.0-only
import { memo, useEffect, useState } from 'react';
import type { PiSession } from '../api/pi';
import { getDataSource } from '../api/source';
import { usePiProjectNames } from './usePiProjectNames';
import { IconChevronRight, IconFolder, IconPlus, IconSidebar, IconArchive, IconMore } from '../shell/icons';
import { useContextMenu } from '../shell/ContextMenu';
import { useShell } from '../shell/ShellContext';
import { AppConfirmation } from './ServerAppUI';
import { useAppPreference } from '../shell/useAppState';

interface Props {
  collapsed: boolean;
  project: string;
  session?: string;
  sessions?: PiSession[];
  disabled: boolean;
  onNew: () => void;
  onNewProject: (project: string) => void;
  onArchiveProject: (project: string, name: string, sessions: PiSession[]) => void;
  onOpen: (project: string, session: string) => void;
  onArchive: (project: string, session: PiSession) => void;
  revision: number;
  onCollapse: () => void;
}
export const PiSidebar = memo(function PiSidebar({ collapsed, project: projectPath, session, sessions, disabled, onNew, onNewProject, onArchiveProject, onOpen, onArchive, revision, onCollapse }: Props) {
  const source = getDataSource();
  const menu = useContextMenu();
  const { actions } = useShell();
  const [projectNames, setProjectNames] = usePiProjectNames();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const project = projectPath === '~' ? source.absolutePath(source.homePath()) : projectPath;
  const [remembered, setRemembered] = useAppPreference<string[]>('pi', 'projects', []);
  const [recentsExpanded, setRecentsExpanded] = useAppPreference<boolean>('pi', 'recents-expanded', true);
  const [lists, setLists] = useState<Record<string, PiSession[]>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [recentLimit, setRecentLimit] = useState(6);
  const projects = [...new Set([...remembered, project])].filter((path) => path.startsWith('/'));
  const projectKey = projects.join('\n');

  useEffect(() => {
    if (project.startsWith('/') && !remembered.includes(project)) setRemembered((items) => [project, ...items].slice(0, 30));
  }, [project, remembered, setRemembered]);
  useEffect(() => {
    let disposed = false;
    const others = projects.filter((path) => path !== project);
    void Promise.allSettled(others.map(async (path) => ({ path, sessions: await source.piSessions(path) }))).then((results) => {
      if (disposed) return;
      const next: Record<string, PiSession[]> = {};
      const failed: string[] = [];
      results.forEach((result, index) => { if (result.status === 'fulfilled') next[result.value.path] = result.value.sessions; else failed.push(others[index]); });
      setLists((previous) => ({ ...previous, ...next })); setErrors(failed);
    });
    return () => { disposed = true; };
  }, [projectKey, project, source, revision]);
  useEffect(() => {
    if (sessions) setLists((previous) => ({ ...previous, [project]: sessions }));
  }, [project, sessions]);
  const groups = { ...lists, ...(sessions ? { [project]: sessions } : {}) };
  const recent = projects.flatMap((path) => (groups[path] ?? []).map((item) => ({ ...item, project: path }))).sort((a, b) => b.modified.localeCompare(a.modified));
  const folderName = (path: string) => projectNames[path] || path.split('/').filter(Boolean).at(-1) || '/';
  const active = (path: string, id: string) => path === project && id === session;

  return <aside className={`pi-sidebar${collapsed ? ' is-collapsed' : ''}`} data-testid="pi-sidebar">
    <header className="pi-sidebar-top">
      <button className="pi-sidebar-row pi-new-chat" aria-label="New chat" title="New chat" disabled={disabled} onClick={onNew} data-testid="pi-new"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 4H6a3 3 0 0 0-3 3v11a3 3 0 0 0 3 3h11a3 3 0 0 0 3-3v-4M15 4l5 5M10 14l-1 4 4-1 8-8a2 2 0 0 0-5-5z"/></svg><span>New chat</span></button>
      <button className="pi-sidebar-toggle" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={onCollapse}><IconSidebar size={17}/></button>
    </header>
    <div className="pi-sidebar-scroll" ref={(node) => node?.toggleAttribute('inert', collapsed)}>
      <nav aria-label="Pi projects" className="pi-projects">
        <h2>Projects</h2>
        {projects.map((path) => {
          const items = groups[path]; const limit = limits[path] ?? 5;
          return <div className="pi-project-group" key={path}>
            <div className="pi-project-heading">
              <div className="pi-sidebar-row pi-project-row" title={path}><IconFolder size={18}/><span>{folderName(path)}</span></div>
              <div className="pi-project-actions">
                <button type="button" aria-label={`Workspace options for ${folderName(path)}`} title="Workspace options" aria-haspopup="menu" disabled={disabled} onClick={(event) => menu(event, [
                  { label: 'Edit name', run: () => { setRenaming(path); setLabel(folderName(path)); } },
                  { label: 'Reveal in Files', run: () => actions.openFolder(['', ...path.split('/').filter(Boolean)]) },
                  { label: 'Archive chats', disabled: !items?.length, run: () => onArchiveProject(path, folderName(path), items ?? []) },
                ])}><IconMore size={16}/></button>
                <button type="button" aria-label={`New chat in ${folderName(path)}`} title="New chat in this workspace" disabled={disabled} onClick={() => onNewProject(path)}><IconPlus size={16}/></button>
              </div>
            </div>
            <div className="pi-project-chats" aria-label={`${folderName(path)} chats`}>
              {items?.slice(0, limit).map((item) => <div key={item.id} className="pi-chat-item"><button className={`pi-sidebar-row pi-chat-row${active(path, item.id) ? ' is-active' : ''}`} disabled={disabled} onClick={() => onOpen(path, item.id)} aria-current={active(path, item.id) ? 'page' : undefined} title={item.name}><span>{item.name}</span></button><button className="pi-chat-archive" disabled={disabled} aria-label={`Archive ${item.name}`} title="Archive conversation" onClick={() => onArchive(path, item)}><IconArchive size={14}/></button></div>)}
              {!items && <p className="pi-sidebar-empty">{errors.includes(path) ? 'Folder unavailable' : 'Loading chats…'}</p>}
              {items?.length === 0 && <p className="pi-sidebar-empty">No chats yet</p>}
              {items && items.length > limit && <button className="pi-sidebar-row pi-show-more" onClick={() => setLimits((values) => ({ ...values, [path]: limit + 5 }))}>Show more</button>}
            </div>
          </div>;
        })}
      </nav>
      <nav aria-label="Recent Pi chats" className="pi-recents">
        <h2><button className="pi-recents-toggle" aria-expanded={recentsExpanded} onClick={() => setRecentsExpanded((value) => !value)} data-testid="pi-recents-toggle"><span>Recents</span><IconChevronRight size={14}/></button></h2>
        <div className={`pi-disclosure${recentsExpanded ? ' is-open' : ''}`} aria-hidden={!recentsExpanded} ref={(node) => node?.toggleAttribute('inert', !recentsExpanded)}><div className="pi-disclosure-content">
        {recent.slice(0, recentLimit).map((item) => <div key={`${item.project}/${item.id}`} className="pi-chat-item"><button className="pi-sidebar-row" disabled={disabled} onClick={() => onOpen(item.project, item.id)} title={`${item.name}\n${item.project}`}><span>{item.name}</span></button><button className="pi-chat-archive" disabled={disabled} aria-label={`Archive ${item.name}`} title="Archive conversation" onClick={() => onArchive(item.project, item)}><IconArchive size={14}/></button></div>)}
        {recent.length === 0 && <p className="pi-sidebar-empty">No recent chats</p>}
        {recent.length > recentLimit && <button className="pi-sidebar-row pi-show-more" onClick={() => setRecentLimit((limit) => limit + 6)}>Show more</button>}
        </div></div>
      </nav>
    </div>

    {renaming && <AppConfirmation title="Edit workspace name" confirm="Save" confirmDisabled={!label.trim()} onCancel={() => setRenaming(null)} onConfirm={() => { setProjectNames(renaming, label.trim()); setRenaming(null); }}><input className="input" aria-label="Workspace name" value={label} maxLength={100} onChange={(event) => setLabel(event.target.value)}/></AppConfirmation>}
  </aside>;
});
