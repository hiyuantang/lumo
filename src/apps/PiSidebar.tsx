// SPDX-License-Identifier: AGPL-3.0-only
import { memo, useEffect, useState } from 'react';
import type { PiSession } from '../api/pi';
import { getDataSource } from '../api/source';
import { usePiProjectNames } from './usePiProjectNames';
import { IconChevronRight, IconFolder, IconPlus, IconNewChat, IconMore, IconArchive } from '../shell/icons';
import { useContextMenu } from '../shell/ContextMenu';
import { useShell } from '../shell/ShellContext';
import { AppConfirmation } from './ServerAppUI';
import { conversationDrag } from './piConversationReferences';
import { useAppPreference } from '../shell/useAppState';

interface Props {
  collapsed: boolean;
  project: string;
  session?: string;
  sessions?: PiSession[];
  disabled: boolean;
  navigationDisabled?: boolean;
  running: string[];
  floating: string[];
  onRename: (project: string, session: PiSession) => void;
  onAssistant: (project: string, session: PiSession, floating: boolean) => void;
  onNew: () => void;
  onNewProject: (project: string) => void;
  onArchiveProject: (project: string, name: string, sessions: PiSession[]) => void;
  onRemoveProject: (project: string, name: string) => void;
  onOpen: (project: string, session: string) => void;
  onArchive: (project: string, session: PiSession) => void;
  revision: number | string;
}
export const PiSidebar = memo(function PiSidebar({ collapsed, project: projectPath, session, sessions, disabled, navigationDisabled = disabled, running, floating, onRename, onAssistant, onNew, onNewProject, onArchiveProject, onRemoveProject, onOpen, onArchive, revision }: Props) {
  const source = getDataSource();
  const menu = useContextMenu();
  const { actions } = useShell();
  const [projectNames, setProjectNames] = usePiProjectNames();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const project = projectPath === '~' ? source.absolutePath(source.homePath()) : projectPath;
  const [remembered, setRemembered] = useAppPreference<string[]>('pi', 'projects', []);
  const [removed] = useAppPreference<string[]>('pi', 'removed-projects', []);
  const [recentsExpanded, setRecentsExpanded] = useAppPreference<boolean>('pi', 'recents-expanded', true);
  const [lists, setLists] = useState<Record<string, PiSession[]>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [recentLimit, setRecentLimit] = useState(6);
  const projects = [...new Set([...remembered, project])].filter((path) => path.startsWith('/') && !removed.includes(path));
  const projectKey = projects.join('\n');

  useEffect(() => {
    if (project.startsWith('/') && !removed.includes(project) && !remembered.includes(project)) setRemembered((items) => [project, ...items].slice(0, 30));
  }, [project, remembered, removed, setRemembered]);
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

  function chat(item: PiSession, path: string, inProject: boolean) {
    const working = running.includes(`${path}/${item.id}`);
    return <div key={`${path}/${item.id}`} className="pi-chat-item" {...conversationDrag(path, item)}>
      <button className={`pi-sidebar-row${inProject ? ' pi-chat-row' : ''}${active(path, item.id) ? ' is-active' : ''}`} disabled={navigationDisabled} onClick={() => onOpen(path, item.id)} aria-current={active(path, item.id) ? 'page' : undefined} title={`${item.name}\n${path}`}><span>{item.name}</span></button>
      {working && <span className="pi-chat-working" role="status" aria-label={`Working on ${item.name}`} data-testid="pi-chat-working"><span/></span>}
      <button type="button" className="pi-chat-action pi-chat-archive" disabled={disabled || working} aria-label={`Archive ${item.name}`} title="Archive chat" data-testid="pi-chat-archive" onClick={() => onArchive(path, item)}><IconArchive size={16}/></button>
      <button type="button" className="pi-chat-action pi-chat-options" disabled={navigationDisabled} aria-label={`Chat options for ${item.name}`} title="Chat options" aria-haspopup="menu" data-testid="pi-chat-options" onClick={(event) => menu(event, [
        { label: 'Rename', disabled: disabled || working, run: () => onRename(path, item) },
        { label: floating.includes(`${path}/${item.id}`) ? 'Return to Pi window' : 'Pop out chat', disabled, run: () => onAssistant(path, item, !floating.includes(`${path}/${item.id}`)) },
        { label: 'Archive', disabled: disabled || working, separator: true, run: () => onArchive(path, item) },
      ])}><IconMore size={16}/></button>
    </div>;
  }

  return <aside className={`pi-sidebar${collapsed ? ' is-collapsed' : ''}`} data-testid="pi-sidebar" id="pi-chat-sidebar" aria-hidden={collapsed} ref={(node) => node?.toggleAttribute('inert', collapsed)}>
    <header className="pi-sidebar-top">
      <button className="pi-sidebar-row pi-new-chat" aria-label="New chat" title="New chat" disabled={navigationDisabled} onClick={onNew} data-testid={collapsed ? undefined : "pi-new"}><IconNewChat size={19}/><span>New chat</span></button>
    </header>
    <div className="pi-sidebar-scroll">
      <nav aria-label="Pi projects" className="pi-projects">
        <h2>Projects</h2>
        {projects.map((path) => {
          const items = groups[path]; const limit = limits[path] ?? 5;
          return <div className="pi-project-group" key={path}>
            <div className="pi-project-heading">
              <div className="pi-sidebar-row pi-project-row" title={path}><IconFolder size={16}/><span>{folderName(path)}</span></div>
              <div className="pi-project-actions">
                <button type="button" aria-label={`Workspace options for ${folderName(path)}`} title="Workspace options" aria-haspopup="menu" disabled={disabled} onClick={(event) => menu(event, [
                  { label: 'Edit name', run: () => { setRenaming(path); setLabel(folderName(path)); } },
                  { label: 'Reveal in Files', run: () => actions.openFolder(['', ...path.split('/').filter(Boolean)]) },
                  { label: 'Archive chats', disabled: !items?.length, run: () => onArchiveProject(path, folderName(path), items ?? []) },
                  { label: 'Remove workspace', run: () => onRemoveProject(path, folderName(path)) },
                ])}><IconMore size={16}/></button>
                <button type="button" aria-label={`New chat in ${folderName(path)}`} title="New chat in this workspace" disabled={navigationDisabled} onClick={() => onNewProject(path)}><IconPlus size={16}/></button>
              </div>
            </div>
            <div className="pi-project-chats" aria-label={`${folderName(path)} chats`}>
              {items?.slice(0, limit).map((item) => chat(item, path, true))}
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
        {recent.slice(0, recentLimit).map((item) => chat(item, item.project, false))}
        {recent.length === 0 && <p className="pi-sidebar-empty">No recent chats</p>}
        {recent.length > recentLimit && <button className="pi-sidebar-row pi-show-more" onClick={() => setRecentLimit((limit) => limit + 6)}>Show more</button>}
        </div></div>
      </nav>
    </div>

    {renaming && <AppConfirmation title="Edit workspace name" confirm="Save" confirmDisabled={!label.trim()} onCancel={() => setRenaming(null)} onConfirm={() => { setProjectNames(renaming, label.trim()); setRenaming(null); }}><input className="input" aria-label="Workspace name" value={label} maxLength={100} onChange={(event) => setLabel(event.target.value)}/></AppConfirmation>}
  </aside>;
});
