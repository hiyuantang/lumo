// SPDX-License-Identifier: AGPL-3.0-only
import { useAppMenus } from '@lumo/sdk/shell/appMenus';
import { useReorder } from '@lumo/sdk/shell/useReorder';
import { copyText, readClipboard } from '@lumo/sdk/utils/clipboard';
import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm, type ITheme } from '@xterm/xterm';
import { describeError, getDataSource } from '@lumo/sdk/api/source';
import { useContextMenu } from '@lumo/sdk/shell/ContextMenu';
import { useCurrentWindow } from '@lumo/sdk/shell/WindowContext';
import { useShell } from '@lumo/sdk/shell/ShellContext';
import '@xterm/xterm/css/xterm.css';
import './terminal.css';

interface TabState {
  id: number;
  name: string;
  epoch: number;
  exitCode: number | null;
  error: string | null;
}

let nextTabId = 1;
const TAB_NAMES = ['Cookie', 'Chocolate', 'Cocoa', 'Mochi', 'Waffle', 'Truffle', 'Biscuit', 'Caramel', 'Maple', 'Brownie', 'Cinnamon', 'Hazelnut', 'Toffee', 'Pudding', 'Macaron', 'Vanilla'];
function newTab(tabs: TabState[]): TabState {
  let names = TAB_NAMES.filter((name) => !tabs.some((tab) => tab.name === name));
  for (let batch = 0; names.length === 0; batch++) {
    const prefix = ['Golden', 'Velvet', 'Sweet', 'Little'][batch % 4];
    names = TAB_NAMES.map((name) => `${prefix} ${name}${batch < 4 ? '' : ` ${Math.floor(batch / 4) + 1}`}`).filter((name) => !tabs.some((tab) => tab.name === name));
  }
  return { id: nextTabId++, name: names[Math.floor(Math.random() * names.length)], epoch: 0, exitCode: null, error: null };
}

function readTheme(): ITheme {
  const styles = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    background: v('--surface-sunken', '#101010'),
    foreground: v('--text', '#f5f5f5'),
    cursor: v('--accent', '#eeeeee'),
    selectionBackground: v('--accent-soft', 'rgba(255, 255, 255, 0.12)'),
  };
}

export function Terminal() { return <TerminalWorkspace />; }

export function TerminalWorkspace({ program, directory }: { program?: 'pi'; directory?: string }) {
  const { capabilities } = getDataSource();
  if (!capabilities.canTerminal) {
    return (
      <div className="app terminal" data-testid="app-terminal">
        <div className="terminal-placeholder">
          <p className="terminal-placeholder-title">Terminal</p>
          <p>Terminal unavailable.</p>
        </div>
      </div>
    );
  }
  return <TerminalTabs program={program} directory={directory} />;
}

function TerminalTabs({ program, directory }: { program?: 'pi'; directory?: string }) {
  const win = useCurrentWindow();
  const openContextMenu = useContextMenu();
  const { state, actions } = useShell();
  const user = state.user ?? 'user';
  const [tabs, setTabs] = useState<TabState[]>(() => [newTab([])]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const effectiveActive = tabs.some((tab) => tab.id === activeId) ? activeId : (tabs[0]?.id ?? null);

  const reorder = useReorder(tabs, setTabs, (tab) => tab.id, 'horizontal');

  function updateTab(id: number, patch: Partial<TabState>) {
    setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)));
  }

  function addTab() {
    const tab = newTab(tabs);
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
  }

  function closeTab(id: number) {
    if (tabs.length === 1 && tabs[0].id === id) {
      actions.closeApp(win.id);
      return;
    }
    if (effectiveActive === id) {
      const index = tabs.findIndex((tab) => tab.id === id);
      setActiveId(tabs[index + 1]?.id ?? tabs[index - 1]?.id ?? null);
    }
    setTabs((prev) => prev.filter((tab) => tab.id !== id));
  }

  useAppMenus({ file: [
    { id: 'new-tab', label: 'New Tab', run: addTab },
    { id: 'close-tab', label: 'Close Tab', disabled: effectiveActive === null, run: () => { if (effectiveActive !== null) closeTab(effectiveActive); } },
  ] });

  return (
    <div className="app terminal" data-testid={program ? 'pi-terminal' : 'app-terminal'}>
      <div className="terminal-tabs" role="tablist" aria-label="Terminal tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            {...reorder.bind(tab)}
            className={`terminal-tab${tab.id === effectiveActive ? ' active' : ''}`}
            role="tab"
            aria-selected={tab.id === effectiveActive}
            aria-label={`${tab.name}${tab.exitCode !== null ? ", exited" : ""}`}
            data-testid={`terminal-tab-${tab.id}`}
            onContextMenu={(event) => openContextMenu(event, [
              { label: 'New Tab', run: addTab },
              ...(tab.exitCode !== null ? [{ label: 'Restart Tab', run: () => updateTab(tab.id, { epoch: tab.epoch + 1, exitCode: null, error: null }) }] : []),
              { label: 'Close Tab', separator: true, run: () => closeTab(tab.id) },
            ])}
          >
            <button type="button" className="terminal-tab-label" title="Drag to reorder · Alt + Left/Right" aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight" onClick={() => setActiveId(tab.id)}>
              {tab.name}{tab.exitCode !== null && <span className="terminal-tab-status">Exited</span>}
            </button>
            <button
              type="button"
              className="terminal-tab-close"
              aria-label={`Close ${tab.name}`}
              data-testid={`terminal-close-tab-${tab.id}`}
              onClick={() => closeTab(tab.id)}
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" className="terminal-tab-new" data-testid="terminal-new-tab" aria-label="New tab" onClick={addTab}>
          +
        </button>
      </div>
      <div className="terminal-panes">
        {tabs.map((tab) => (
          <TerminalPane
            key={`${tab.id}:${tab.epoch}`}
            tab={tab}
            user={user}
            program={program}
            directory={directory}
            visible={tab.id === effectiveActive}
            onExit={(code) => updateTab(tab.id, { exitCode: code })}
            onError={(message) => updateTab(tab.id, { error: message })}
            onRestart={() => updateTab(tab.id, { epoch: tab.epoch + 1, exitCode: null, error: null })}
          />
        ))}
      </div>
    </div>
  );
}

interface PaneProps {
  program?: 'pi';
  directory?: string;
  tab: TabState;
  user: string;
  visible: boolean;
  onExit: (code: number) => void;
  onError: (message: string) => void;
  onRestart: () => void;
}

function TerminalPane({ tab, user, program, directory, visible, onExit, onError, onRestart }: PaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const callbacksRef = useRef({ onExit, onError });
  callbacksRef.current = { onExit, onError };
  const { resolvedTheme, actions } = useShell();
  const openContextMenu = useContextMenu();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new XTerm({
      fontFamily: 'var(--font-mono)',
      fontSize: 12.5,
      cursorBlink: true,
      theme: readTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    const safeFit = () => {
      if (host.clientWidth === 0 || host.clientHeight === 0) return;
      fit.fit();
    };
    safeFit();
    term.focus();

    const session = getDataSource().openTerminal(
      { cols: term.cols, rows: term.rows, user, program, directory },
      {
        onData: (data) => term.write(data),
        onExit: (code) => callbacksRef.current.onExit(code),
        onError: (err) => callbacksRef.current.onError(describeError(err)),
        onReset: () => term.reset(),
      },
    );
    const inputSub = term.onData((data) => session.write(data));
    const resizeSub = term.onResize(({ cols, rows }) => session.resize(cols, rows));
    const observer = new ResizeObserver(safeFit);
    observer.observe(host);
    return () => {
      observer.disconnect();
      inputSub.dispose();
      resizeSub.dispose();
      session.close();
      term.dispose();
      termRef.current = null;
    };
  }, [user, program, directory]);

  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.theme = readTheme();
  }, [resolvedTheme]);

  useEffect(() => {
    const textarea = hostRef.current?.querySelector('textarea');
    if (textarea) {
      if (visible) textarea.setAttribute('data-testid', program ? 'pi-input' : 'terminal-input');
      else textarea.removeAttribute('data-testid');
    }
    if (visible) termRef.current?.focus();
  }, [visible, program]);

  return (
    <div className={`terminal-pane${visible ? '' : ' hidden'}`}>
      <div className="terminal-host" ref={hostRef} onContextMenu={(event) => {
        const term = termRef.current;
        if (!term) { event.preventDefault(); event.stopPropagation(); return; }
        const selection = term.getSelection();
        const error = () => actions.notify('Clipboard unavailable', 'Use the keyboard shortcut to copy or paste.');
        openContextMenu(event, [
          { label: 'Copy', disabled: !selection, run: () => { void copyText(selection).catch(error); } },
          { label: 'Paste', disabled: tab.exitCode !== null, run: () => { void readClipboard().then((text) => { term.focus(); term.paste(text); }).catch(error); } },
          { label: 'Select All', run: () => { term.selectAll(); term.focus(); } },
          { label: 'Clear Display', separator: true, run: () => { term.clear(); term.focus(); } },
        ]);
      }} />
      {tab.error && (
        <div className="terminal-error" data-testid="terminal-error" role="alert">
          {tab.error}
        </div>
      )}
      {tab.exitCode !== null && (
        <div className="terminal-exited" data-testid="terminal-exited">
          <p>Process exited{tab.exitCode !== 0 ? ` (code ${tab.exitCode})` : ''}.</p>
          <button type="button" className="btn" data-testid="terminal-restart" onClick={onRestart}>
            Restart
          </button>
        </div>
      )}
    </div>
  );
}
