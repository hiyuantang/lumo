// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useSyncExternalStore } from 'react';
import { getDataSource, isReauthRequired, describeError, type UpdatePlan, type UpdateProgress } from '../api/source';
import type { LibraryAppID } from '../api/server-apps';

type Item = { app: LibraryAppID; plan: UpdatePlan; status: 'pending' | 'updating' | 'done' | 'failed'; progress?: UpdateProgress; error?: string };
type Snapshot = { items: Item[]; phase: 'idle' | 'running' | 'auth' | 'disconnected'; requestId: string | null };
const queues = new Map<string, AppUpdates>();

class AppUpdates {
  private source = getDataSource();
  private key: string;
  private listeners = new Set<() => void>();
  private unsubscribe?: () => void;
  private connected = false;
  private snapshot: Snapshot = { items: [], phase: 'idle', requestId: null };

  constructor(private user: string) {
    this.key = `lumo-app-updates:${this.source.kind}:${user}`;
    try {
      const saved = JSON.parse(localStorage.getItem(this.key) || 'null') as Snapshot | null;
      if (saved && Array.isArray(saved.items) && saved.items.length <= 4 && saved.items.every((item) => (item.app === 'git' || item.app === 'docker' || item.app === 'nginx' || item.app === 'pi') && Array.isArray(item.plan?.packages))) {
        this.snapshot = { ...saved, phase: 'disconnected' };
        if (!saved.requestId) this.stop('The update was interrupted. Check for updates before trying again.');
      }
    } catch {}
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  private publish(next: Snapshot) {
    this.snapshot = next;
    try {
      if (next.phase === 'idle') localStorage.removeItem(this.key);
      else localStorage.setItem(this.key, JSON.stringify(next));
    } catch {}
    this.listeners.forEach((listener) => listener());
  }

  private change(app: LibraryAppID, patch: Partial<Item>) {
    this.publish({ ...this.snapshot, items: this.snapshot.items.map((item) => item.app === app ? { ...item, ...patch } : item) });
  }

  private async checkAccount() {
    if (this.source.kind === 'mock') return;
    const session = await this.source.getSession();
    if (session?.name !== this.user) throw new Error('Sign in with the account that started these updates to continue.');
  }

  connect = () => {
    if (this.connected) return;
    this.connected = true;
    if (this.snapshot.requestId) void this.reconnect();
  };

  start = (plans: UpdatePlan[]) => {
    if (this.snapshot.phase !== 'idle') return;
    const items: Item[] = plans.filter((plan) => plan.packages.length && (plan.appId === 'git' || plan.appId === 'docker' || plan.appId === 'nginx' || plan.appId === 'pi')).map((plan) => ({ app: plan.appId!, plan, status: 'pending' }));
    if (!items.length) return;
    this.publish({ items, phase: 'running', requestId: null });
    void this.next();
  };

  clear = () => {
    if (this.snapshot.phase === 'idle') this.publish({ items: [], phase: 'idle', requestId: null });
  };

  resume = () => {
    if (this.snapshot.phase !== 'auth') return;
    this.publish({ ...this.snapshot, phase: 'running' });
    void this.next();
  };

  reconnect = async () => {
    const requestId = this.snapshot.requestId;
    if (!requestId) return;
    try {
      await this.checkAccount();
      this.publish({ ...this.snapshot, phase: 'running' });
      this.watch(requestId);
    } catch (err) { this.disconnected(err); }
  };

  forget = () => {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.stop('Status unavailable. Check for updates before trying again.');
  };

  private stop(message: string) {
    this.publish({ phase: 'idle', requestId: null, items: this.snapshot.items.filter((item) => item.status !== 'pending').map((item) => item.status === 'updating' ? { ...item, status: 'failed', error: message } : item) });
  }

  private disconnected(err: unknown) {
    const current = this.snapshot.items.find((item) => item.status === 'updating');
    if (current) this.change(current.app, { error: `${describeError(err)} The update may still be running.` });
    this.publish({ ...this.snapshot, phase: 'disconnected' });
  }

  private async next() {
    const item = this.snapshot.items.find((item) => item.status === 'updating' || item.status === 'pending');
    if (!item) { this.publish({ ...this.snapshot, phase: 'idle', requestId: null }); return; }
    this.change(item.app, { status: 'updating', error: undefined });
    try {
      await this.checkAccount();
      const plan = await this.source.planAppInstall(item.app, 'update');
      this.change(item.app, { plan });
      if (!plan.packages.length) { this.change(item.app, { status: 'done' }); void this.next(); return; }
      await this.checkAccount();
      const requestId = await this.source.applyUpdatePlan(plan.id);
      this.publish({ ...this.snapshot, requestId });
      this.watch(requestId);
    } catch (err) {
      if (isReauthRequired(err)) this.publish({ ...this.snapshot, phase: 'auth' });
      else this.stop(describeError(err));
    }
  }

  private watch(requestId: string) {
    this.unsubscribe?.();
    this.unsubscribe = this.source.subscribeUpdateProgress(requestId, (progress) => {
      if (this.snapshot.requestId !== requestId) return;
      const item = this.snapshot.items.find((item) => item.status === 'updating');
      if (!item) return;
      this.change(item.app, { progress, error: undefined });
      if (!progress.done) return;
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      if (!progress.success) { this.stop(progress.error || 'Update failed. Check the package manager output.'); return; }
      this.change(item.app, { status: 'done' });
      this.publish({ ...this.snapshot, requestId: null, phase: 'running' });
      void this.next();
    }, (err) => { if (this.snapshot.requestId === requestId) this.disconnected(err); });
  }
}

export function useAppUpdates(user: string) {
  const key = `${getDataSource().kind}:${user}`;
  let queue = queues.get(key);
  if (!queue) { queue = new AppUpdates(user); queues.set(key, queue); }
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
  useEffect(queue.connect, [queue]);
  return { queue, ...snapshot };
}
