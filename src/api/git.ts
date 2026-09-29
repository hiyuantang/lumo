// SPDX-License-Identifier: AGPL-3.0-only
export interface GitFile { path: string; original?: string; index: string; worktree: string; conflict: boolean }
export interface GitCommit { id: string; subject: string; author: string; date: string; body: string }
export interface GitBranch { name: string; ref: string; remote?: string; date?: string; upstream?: string; default: boolean }
export interface GitSnapshot { path: string; branch: string; head: string; revision: string; upstream: string; ahead: number; behind: number; branches: string[]; branchDetails?: GitBranch[]; remotes: string[]; files: GitFile[]; history: GitCommit[]; operation: string }
export interface GitDiff { text: string; truncated: boolean }
export interface GitAction { path: string; revision: string; action: 'init' | 'clone' | 'stage' | 'unstage' | 'commit' | 'switch' | 'create-branch' | 'switch-remote' | 'merge' | 'abort-merge' | 'fetch' | 'pull' | 'push'; url?: string; files?: string[]; file?: string; branch?: string; remote?: string; message?: string }
