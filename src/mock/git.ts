// SPDX-License-Identifier: AGPL-3.0-only
import type { GitAction, GitDiff, GitSnapshot } from '../api/git';

export class MockGit {
  private snapshot: GitSnapshot = {
    path: '/home/user/projects/lumo-agent', branch: 'main', head: 'a'.repeat(40), revision: '0', upstream: 'origin/main', ahead: 0, behind: 0, operation: '', branches: ['main', 'feature/metrics'], remotes: ['origin'],
    branchDetails: [
      { name: 'main', ref: 'refs/heads/main', default: true, date: '2026-09-28T12:15:00Z', upstream: 'origin/main' },
      { name: 'feature/metrics', ref: 'refs/heads/feature/metrics', default: false, date: '2026-09-27T16:40:00Z' },
      { name: 'origin/main', ref: 'refs/remotes/origin/main', remote: 'origin', default: true, date: '2026-09-28T12:15:00Z' },
      { name: 'origin/feature/logs', ref: 'refs/remotes/origin/feature/logs', remote: 'origin', default: false, date: '2026-09-26T09:00:00Z' },
    ],
    files: [{ path: 'src/agent.ts', index: ' ', worktree: 'M', conflict: false }, { path: 'README.md', index: ' ', worktree: 'M', conflict: false }, { path: 'tests/metrics.test.ts', index: '?', worktree: '?', conflict: false }],
    history: [{ id: 'a'.repeat(40), subject: 'Report host metrics', author: 'Alex Morgan', date: '2026-09-28T12:15:00Z', body: 'Include memory and CPU usage in the host summary.' }, { id: 'b'.repeat(40), subject: 'Add service configuration', author: 'Alex Morgan', date: '2026-09-27T16:40:00Z', body: '' }, { id: 'c'.repeat(40), subject: 'Create agent workspace', author: 'Alex Morgan', date: '2026-09-26T09:00:00Z', body: '' }],
  };
  async repository(path: string): Promise<GitSnapshot> { if (path !== this.snapshot.path) throw new Error('This folder is not a Git repository. Choose projects/lumo-agent.'); return structuredClone(this.snapshot); }
  async diff(_path: string, file: string, _commit: string, _staged: boolean): Promise<GitDiff> {
    if (file === 'README.md') return { text: 'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1,3 +1,5 @@\n # Lumo agent\n \n-Reports host metrics.\n+Reports CPU and memory usage.\n+\n+Run the agent as your Linux user.\n', truncated: false };
    if (file.startsWith('tests/')) return { text: 'New file: tests/metrics.test.ts\n+import { test } from "node:test";\n+import assert from "node:assert/strict";\n+\n+test("reports memory usage", () => {\n+  assert.ok(collectMetrics().memoryBytes > 0);\n+});', truncated: false };
    return { text: `diff --git a/src/agent.ts b/src/agent.ts\n--- a/src/agent.ts\n+++ b/src/agent.ts\n@@ -8,7 +8,10 @@\n export function collectMetrics() {\n   return {\n     hostname: os.hostname(),\n-    memory: os.totalmem(),\n+    memory: {\n+      total: os.totalmem(),\n+      available: os.freemem(),\n+    },\n     cpu: os.loadavg(),\n     at: new Date().toISOString(),\n   };\n }\n`, truncated: false };
  }
  async action(req: GitAction): Promise<void> {
    if (req.action === 'init' || req.action === 'clone') {
      if (req.path === this.snapshot.path) throw new Error('The destination already exists.');
      this.snapshot = { path: req.path, branch: 'main', head: req.action === 'clone' ? 'a'.repeat(40) : '', revision: '0', upstream: req.action === 'clone' ? 'origin/main' : '', ahead: 0, behind: 0, operation: '', branches: ['main'], branchDetails: [{ name: 'main', ref: 'refs/heads/main', default: true }], remotes: req.action === 'clone' ? ['origin'] : [], files: [], history: [] };
      return;
    }
    const s = this.snapshot;
    if (req.path !== s.path || req.revision !== s.revision) throw new Error('The repository changed. Refresh before trying again.');
    const chosen = s.files.filter((f) => f.path === req.file || req.files?.includes(f.path));
    for (const file of chosen) {
    if (req.action === 'stage' && file) { file.index = file.index === '?' ? 'A' : file.worktree; file.worktree = ' '; }
    if (req.action === 'unstage' && file) { file.worktree = file.index === 'A' ? '?' : file.index; file.index = file.index === 'A' ? '?' : ' '; }
    }
    if (req.action === 'commit') { if (!req.message?.trim() || !s.files.some((f) => ![' ', '?'].includes(f.index))) throw new Error('Stage changes and enter a summary.'); const [subject, ...body] = req.message.split('\n'); s.head = String(Number(s.revision) + 1).padStart(40, 'd'); s.history.unshift({ id: s.head, subject, body: body.join('\n'), author: 'Demo user', date: new Date().toISOString() }); s.files = s.files.filter((f) => [' ', '?'].includes(f.index)); s.ahead++; }
    if (req.action === 'switch' || req.action === 'create-branch') { if (s.files.length) throw new Error('Commit or stash your changes before switching branches.'); if (!req.branch) throw new Error('Enter a branch name.'); if (req.action === 'create-branch') { if (s.branches.includes(req.branch)) throw new Error('Branch already exists.'); s.branches.push(req.branch); s.branchDetails?.push({ name: req.branch, ref: `refs/heads/${req.branch}`, default: false, date: new Date().toISOString() }); } s.branch = req.branch; s.upstream = req.branch === 'main' ? 'origin/main' : ''; }
    if (req.action === 'switch-remote') {
      if (s.files.length) throw new Error('Commit or stash your changes before switching branches.');
      const branch = s.branchDetails?.find((item) => item.ref === req.branch && item.remote);
      if (!branch) throw new Error('Choose a remote branch.');
      const name = branch.name.slice(branch.remote!.length + 1);
      if (s.branches.includes(name)) throw new Error('A local branch with this name already exists.');
      s.branches.push(name); s.branch = name; s.upstream = branch.name;
      s.branchDetails?.push({ name, ref: `refs/heads/${name}`, date: branch.date, default: false, upstream: branch.name });
    }
    if (req.action === 'merge') {
      if (s.files.length || s.operation) throw new Error('Commit or stash changes before merging.');
      const branch = s.branchDetails?.find((item) => item.ref === req.branch);
      if (!branch || branch.ref === `refs/heads/${s.branch}`) throw new Error('Choose another branch.');
      s.head = String(Number(s.revision) + 1).padStart(40, 'e'); s.ahead++;
      s.history.unshift({ id: s.head, subject: `Merge ${branch.name} into ${s.branch}`, body: '', author: 'Demo user', date: new Date().toISOString() });
    }
    if (req.action === 'abort-merge') { if (s.operation !== 'MERGE_HEAD') throw new Error('No merge to abort.'); s.operation = ''; s.files = []; }
    if (req.action === 'push') { s.ahead = 0; s.upstream = `${req.remote}/${s.branch}`; }
    if (req.action === 'pull') s.behind = 0;
    s.revision = String(Number(s.revision) + 1);
  }
}
