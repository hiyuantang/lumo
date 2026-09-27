// SPDX-License-Identifier: AGPL-3.0-only
import type { AppLogs, ContainerAction, ContainerDetail, ContainerSnapshot, Website, WebsiteDefinition, WebsiteResult, WebsiteSnapshot } from '../api/server-apps';
import { ApiError } from '../api/transport';

export class MockServerApps {
  private generation = 0;
  private containers: ContainerDetail[] = [
    { id: 'a'.repeat(64), name: 'notes-web', image: 'nginx:stable-alpine', state: 'running', status: 'Up 3 hours', project: 'notes', revision: 'mock-container-0', created: '2026-09-22T10:00:00Z', startedAt: '2026-09-25T10:00:00Z', exitCode: 0, ports: [{ container: '80/tcp', address: '127.0.0.1', host: '8088' }], mounts: [{ type: 'bind', source: '/srv/notes', destination: '/usr/share/nginx/html', writable: false }] },
    { id: 'b'.repeat(64), name: 'notes-api', image: 'node:22-alpine', state: 'running', status: 'Up 3 hours', project: 'notes', revision: 'mock-container-0', created: '2026-09-22T10:00:00Z', startedAt: '2026-09-25T10:00:00Z', exitCode: 0, ports: [{ container: '3000/tcp', address: '127.0.0.1', host: '3000' }], mounts: [] },
    { id: 'c'.repeat(64), name: 'notes-db', image: 'postgres:16-alpine', state: 'running', status: 'Up 3 days', project: 'notes', revision: 'mock-container-0', created: '2026-09-22T10:00:00Z', startedAt: '2026-09-22T10:00:00Z', exitCode: 0, ports: [{ container: '5432/tcp', address: '', host: '' }], mounts: [{ type: 'volume', source: 'notes-data', destination: '/var/lib/postgresql/data', writable: true }] },
    { id: 'd'.repeat(64), name: 'archive-job', image: 'alpine:3.21', state: 'exited', status: 'Exited (0) 2 hours ago', project: '', revision: 'mock-container-0', created: '2026-09-24T10:00:00Z', startedAt: '2026-09-25T08:00:00Z', exitCode: 0, ports: [], mounts: [] },
  ];
  private sites: Website[] = [
    { id: 'notes', name: 'notes.example.com', path: '/etc/nginx/conf.d/lumo-notes.conf', source: 'server {\n    listen 80;\n    server_name notes.example.com;\n    location / {\n        proxy_pass http://127.0.0.1:8088;\n    }\n}\n', revision: 'mock-site-0', managed: true, definition: { domain: 'notes.example.com', kind: 'proxy', port: 8088, root: '', enabled: true } },
    { id: '/etc/nginx/sites-available/default', name: 'default', path: '/etc/nginx/sites-available/default', source: 'server {\n    listen 80 default_server;\n    root /var/www/html;\n    server_name _;\n    location / {\n        try_files $uri $uri/ =404;\n    }\n}\n', revision: 'mock-custom-0', managed: false },
  ];

  async getContainers(): Promise<ContainerSnapshot> { return structuredClone({ status: 'ready', message: '', version: '27.5.1', containers: this.containers }); }
  async getContainer(id: string): Promise<ContainerDetail> {
    const item = this.containers.find((c) => c.id === id);
    if (!item) throw new ApiError('not_found', 'The container no longer exists.');
    return structuredClone(item);
  }
  async getContainerLogs(id: string): Promise<AppLogs> {
    const item = await this.getContainer(id);
    return { text: `2026-09-25T10:00:00Z ${item.name}: starting\n2026-09-25T10:00:01Z Configuration loaded\n2026-09-25T10:00:02Z Ready to accept connections\n`, truncated: false };
  }
  async runContainerAction(id: string, action: ContainerAction, revision: string): Promise<ContainerDetail> {
    const item = this.containers.find((c) => c.id === id);
    if (!item) throw new ApiError('not_found', 'The container no longer exists.');
    if (item.revision !== revision) throw new ApiError('stale_revision', 'The container changed. Refresh before trying again.');
    item.state = action === 'stop' ? 'exited' : 'running';
    item.status = action === 'stop' ? 'Exited just now' : 'Up just now';
    item.revision = `mock-container-${++this.generation}`;
    return structuredClone(item);
  }
  async getWebsites(): Promise<WebsiteSnapshot> { return structuredClone({ installed: true, sites: this.sites, warnings: [] }); }
  async getWebsiteLogs(kind: 'access' | 'error'): Promise<AppLogs> {
    return { text: kind === 'access' ? '192.0.2.14 - - [25/Sep/2026:10:00:00 +0000] "GET / HTTP/1.1" 200 1248\n' : '', truncated: false };
  }
  async saveWebsite(id: string, definition: WebsiteDefinition, revision: string): Promise<WebsiteResult> {
    const existing = this.sites.find((s) => s.id === id);
    if ((existing?.revision ?? 'absent') !== revision) throw new ApiError('stale_revision', 'The website changed on disk.');
    const site: Website = { id, path: `/etc/nginx/conf.d/lumo-${id}.conf`, name: definition.domain, revision: `mock-site-${++this.generation}`, managed: true, definition: { ...definition }, source: `server {\n    listen 80;\n    server_name ${definition.domain};\n    ${definition.kind === 'proxy' ? `location / { proxy_pass http://127.0.0.1:${definition.port}; }` : `root "${definition.root}";`}\n}\n` };
    this.sites = [...this.sites.filter((s) => s.id !== id), site];
    return structuredClone({ site, reloaded: true, rollbackRef: `demo-backup-${this.generation}` });
  }
}
