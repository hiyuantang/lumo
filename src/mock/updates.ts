// SPDX-License-Identifier: AGPL-3.0-only
import type { PackageCatalog, Unsubscribe, UpdatePlan, UpdateProgress, AppUpdateHistoryEntry } from '../api/source';

let systemUpdated = false;

export async function getPackageCatalog(): Promise<PackageCatalog> {
  return { checkedAt: new Date().toISOString(), rebootRequired: false, packages: [
    { name: 'openssl', version: systemUpdated ? '3.0.13-0ubuntu3.5' : '3.0.13-0ubuntu3.4', architecture: 'amd64', summary: 'Secure communication tools', group: 'system', origin: 'Ubuntu', held: false, security: !systemUpdated, ...(!systemUpdated ? { updateVersion: '3.0.13-0ubuntu3.5', updateGroup: 'system' as const, updateOrigin: 'Ubuntu' } : {}) },
    { name: 'systemd', version: systemUpdated ? '255.4-1ubuntu8.9' : '255.4-1ubuntu8.8', architecture: 'amd64', summary: 'System and service manager', group: 'system', origin: 'Ubuntu', held: false, security: false, ...(!systemUpdated ? { updateVersion: '255.4-1ubuntu8.9', updateGroup: 'system' as const, updateOrigin: 'Ubuntu' } : {}) },
    { name: 'curl', version: '8.5.0-2ubuntu10.6', architecture: 'amd64', summary: 'Transfer data using URLs', group: 'system', origin: 'Ubuntu', held: false, security: false },
    { name: 'docker-ce', version: '27.5.1', architecture: 'amd64', summary: 'Container engine', group: 'third-party', origin: 'Docker', held: false, security: false },
    { name: 'local-tools', version: '1.0', architecture: 'all', summary: 'Local administration tools', group: 'unknown', origin: '', held: true, security: false },
  ] };
}

const history: AppUpdateHistoryEntry[] = [];
export async function getAppUpdateHistory(): Promise<AppUpdateHistoryEntry[]> { return [...history]; }

const progressByRequest = new Map<string, UpdateProgress>();
const appPlans = new Map<string, { plan: UpdatePlan; done: (clean?: boolean) => void }>();
export function rememberAppPlan(plan: UpdatePlan, done: (clean?: boolean) => void): UpdatePlan { appPlans.set(plan.id, { plan, done }); return plan; }

const listeners = new Map<string, Set<(progress: UpdateProgress) => void>>();

export async function refreshUpdates(): Promise<string> {
  await delay(500);
  return new Date().toISOString();
}

export async function calculateUpdatePlan(): Promise<UpdatePlan> {
  await delay(400);
  const now = Date.now();
  return {
    id: `pln_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 15 * 60_000).toISOString(),
    packages: systemUpdated ? [] : [
      {
        name: 'openssl',
        fromVersion: '3.0.13-0ubuntu3.4',
        toVersion: '3.0.13-0ubuntu3.5',
        security: true,
        downloadBytes: 1015808,
        installedDeltaBytes: 0,
      },
      {
        name: 'systemd',
        fromVersion: '255.4-1ubuntu8.8',
        toVersion: '255.4-1ubuntu8.9',
        security: false,
        downloadBytes: 3977216,
        installedDeltaBytes: 32768,
      },
    ],
    securityCount: systemUpdated ? 0 : 1,
    downloadBytes: systemUpdated ? 0 : 4993024,
    installedDeltaBytes: systemUpdated ? 0 : 32768,
    rebootRequired: false,
  };
}

export async function applyUpdatePlan(planId: string, clean = false): Promise<string> {
  const requestId = crypto.randomUUID();
  const progress: UpdateProgress = {
    requestId,
    planId,
    phase: 'queued',
    percent: 0,
    message: 'Waiting for the package manager',
    done: false,
    success: false,
    updatedAt: new Date().toISOString(),
  };
  progressByRequest.set(requestId, progress);
  let step = 0;
  const appPlan = appPlans.get(planId);
  const packageNames = appPlan?.plan.packages.map((pkg) => pkg.name) ?? ['openssl', 'systemd'];
  const stages = [
    { phase: 'downloading', percent: 18, message: 'Downloading packages' },
    { phase: 'installing', percent: 58, message: `Updating ${packageNames[0] ?? 'packages'}` },
    { phase: 'installing', percent: 86, message: `Configuring ${packageNames.at(-1) ?? 'packages'}` },
    { phase: 'complete', percent: 100, message: 'Updates installed' },
  ];
  const timer = window.setInterval(() => {
    const stage = stages[step++];
    if (!stage) {
      window.clearInterval(timer);
      return;
    }
    const next: UpdateProgress = {
      ...progress,
      ...stage,
      done: stage.phase === 'complete',
      success: stage.phase === 'complete',
      updatedAt: new Date().toISOString(),
    };
    if (next.done) {
      if (!appPlan) systemUpdated = true;
      appPlan?.done(clean);
      if (appPlan?.plan.appId && appPlan.plan.operation === 'update') history.unshift({ requestId, appId: appPlan.plan.appId, completedAt: next.updatedAt, success: next.success, packages: appPlan.plan.packages });
    }
    progressByRequest.set(requestId, next);
    listeners.get(requestId)?.forEach((listener) => listener(next));
    if (next.done) window.clearInterval(timer);
  }, 450);
  return requestId;
}

export function subscribeUpdateProgress(requestId: string, listener: (progress: UpdateProgress) => void): Unsubscribe {
  const group = listeners.get(requestId) ?? new Set();
  group.add(listener);
  listeners.set(requestId, group);
  const current = progressByRequest.get(requestId);
  if (current) queueMicrotask(() => listener(current));
  return () => {
    group.delete(listener);
    if (group.size === 0) listeners.delete(requestId);
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
