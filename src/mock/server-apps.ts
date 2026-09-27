// SPDX-License-Identifier: AGPL-3.0-only
import type { DockerResources, DockerResourceRequest, AppLogs, ContainerAction, ContainerDetail, ContainerSnapshot, Website, WebsiteDefinition, WebsiteResult, WebsiteSnapshot } from '../api/server-apps';
import { ApiError } from '../api/transport';

export class MockServerApps {
  private generation = 0;
  engineVersion = '27.5.1';
  private containers: ContainerDetail[] = [
    { id: 'a'.repeat(64), name: 'notes-web', image: 'nginx:stable-alpine', state: 'running', status: 'Up 3 hours', project: 'notes', revision: 'mock-container-0', created: '2026-09-22T10:00:00Z', startedAt: '2026-09-25T10:00:00Z', exitCode: 0, ports: [{ container: '80/tcp', address: '127.0.0.1', host: '8088' }], mounts: [{ type: 'bind', source: '/srv/notes', destination: '/usr/share/nginx/html', writable: false }] },
    { id: 'b'.repeat(64), name: 'notes-api', image: 'node:22-alpine', state: 'running', status: 'Up 3 hours', project: 'notes', revision: 'mock-container-0', created: '2026-09-22T10:00:00Z', startedAt: '2026-09-25T10:00:00Z', exitCode: 0, ports: [{ container: '3000/tcp', address: '127.0.0.1', host: '3000' }], mounts: [] },
    { id: 'c'.repeat(64), name: 'notes-db', image: 'postgres:16-alpine', state: 'running', status: 'Up 3 days', project: 'notes', revision: 'mock-container-0', created: '2026-09-22T10:00:00Z', startedAt: '2026-09-22T10:00:00Z', exitCode: 0, ports: [{ container: '5432/tcp', address: '', host: '' }], mounts: [{ type: 'volume', source: 'notes-data', destination: '/var/lib/postgresql/data', writable: true }] },
    { id: 'd'.repeat(64), name: 'archive-job', image: 'alpine:3.21', state: 'exited', status: 'Exited (0) 2 hours ago', project: '', revision: 'mock-container-0', created: '2026-09-24T10:00:00Z', startedAt: '2026-09-25T08:00:00Z', exitCode: 0, ports: [], mounts: [] },
  ];
  private resources: DockerResources = {
    images: [
      { id: 'sha256:' + '1'.repeat(64), tags: ['nginx:stable-alpine'], created: 1758000000, size: 51200000, sharedSize: 8000000, containers: ['notes-web'], revision: 'mock-image-1' },
      { id: 'sha256:' + '2'.repeat(64), tags: ['node:22-alpine'], created: 1758000000, size: 156000000, sharedSize: 8000000, containers: ['notes-api'], revision: 'mock-image-2' },
      { id: 'sha256:' + '3'.repeat(64), tags: ['postgres:16-alpine'], created: 1758000000, size: 248000000, sharedSize: 8000000, containers: ['notes-db'], revision: 'mock-image-3' },
      { id: 'sha256:' + '4'.repeat(64), tags: ['alpine:3.21'], created: 1758000000, size: 8000000, sharedSize: 8000000, containers: ['archive-job'], revision: 'mock-image-4' },
      { id: 'sha256:' + '5'.repeat(64), tags: [], created: 1757000000, size: 145000000, sharedSize: 8000000, containers: [], revision: 'mock-image-5' },
    ],
    volumes: [
      { removable: false, name: 'notes-data', driver: 'local', scope: 'local', created: '2026-09-22T10:00:00Z', size: 1280000000, containers: ['notes-db'], revision: 'mock-volume-1' },
      { removable: true, name: 'old-backup', driver: 'local', scope: 'local', created: '2026-08-20T10:00:00Z', size: 384000000, containers: [], revision: 'mock-volume-2' },
    ],
    networks: [
      { id: 'e'.repeat(64), name: 'notes_default', driver: 'bridge', scope: 'local', internal: false, subnets: ['172.19.0.0/16'], containers: ['notes-web', 'notes-api', 'notes-db'], removable: false, revision: 'mock-network-1' },
      { id: 'f'.repeat(64), name: 'bridge', driver: 'bridge', scope: 'local', internal: false, subnets: ['172.17.0.0/16'], containers: [], removable: false, revision: 'mock-network-2' },
    ],
    containers: ['a','b','c','d'].map((id, i) => ({ id: id.repeat(64), writableSize: [1200000,24000000,6000000,3200000][i], rootSize: [52400000,180000000,254000000,11200000][i] })),
    imageBytes: 576200000, buildCacheBytes: 98000000, sampledAt: new Date().toISOString(),
  };
  async getDockerResources(): Promise<DockerResources> { return structuredClone({ ...this.resources, sampledAt: new Date().toISOString() }); }
  async runDockerResourceAction(request: DockerResourceRequest): Promise<void> {
    if (request.action === 'create') {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,127}$/.test(request.id)) throw new ApiError('validation_failed', 'Use 2–128 letters, numbers, dots, underscores or hyphens.');
      if (request.kind === 'volume') {
        if (this.resources.volumes.some((v) => v.name === request.id)) throw new ApiError('stale_revision', 'That volume already exists.');
        this.resources.volumes.push({ removable: true, name: request.id, driver: 'local', scope: 'local', created: new Date().toISOString(), size: 0, containers: [], revision: `mock-${++this.generation}` });
      } else if (request.kind === 'network') {
        if (this.resources.networks.some((v) => v.name === request.id)) throw new ApiError('stale_revision', 'That network already exists.');
        this.resources.networks.push({ id: String(++this.generation).padStart(64, '0'), name: request.id, driver: 'bridge', scope: 'local', internal: false, subnets: ['172.20.0.0/16'], containers: [], removable: true, revision: `mock-${this.generation}` });
      } else throw new ApiError('validation_failed', 'Unsupported action.');
      return;
    }
    if (request.kind === 'container') {
      const item = await this.getContainer(request.id);
      if (item.revision !== request.revision) throw new ApiError('stale_revision', 'The container changed.');
      if (item.state === 'running') throw new ApiError('validation_failed', 'Stop the container first.');
      this.containers = this.containers.filter((c) => c.id !== item.id);
      this.resources.containers = this.resources.containers.filter((c) => c.id !== item.id);
      for (const resource of [...this.resources.images, ...this.resources.volumes, ...this.resources.networks]) resource.containers = resource.containers.filter((name) => name !== item.name);
      return;
    }
    const item = request.kind === 'image' ? this.resources.images.find((v) => v.id === request.id) : request.kind === 'volume' ? this.resources.volumes.find((v) => v.name === request.id) : this.resources.networks.find((v) => v.id === request.id);
    if (!item) throw new ApiError('not_found', 'The resource no longer exists.');
    if (item.revision !== request.revision) throw new ApiError('stale_revision', 'The resource changed.');
    if (item.containers.length || ('removable' in item && !item.removable)) throw new ApiError('validation_failed', 'This resource is in use or protected.');
    if (request.kind === 'image') { this.resources.images = this.resources.images.filter((v) => v.id !== request.id); this.resources.imageBytes = Math.max(0, (this.resources.imageBytes ?? 0) - (('size' in item ? item.size : 0) ?? 0) + (('sharedSize' in item ? item.sharedSize : 0) ?? 0)); }
    if (request.kind === 'volume') this.resources.volumes = this.resources.volumes.filter((v) => v.name !== request.id);
    if (request.kind === 'network') this.resources.networks = this.resources.networks.filter((v) => v.id !== request.id);
  }
  private sites: Website[] = [
    { id: 'notes', name: 'notes.example.com', path: '/etc/nginx/conf.d/lumo-notes.conf', source: 'server {\n    listen 80;\n    server_name notes.example.com;\n    location / {\n        proxy_pass http://127.0.0.1:8088;\n    }\n}\n', revision: 'mock-site-0', managed: true, definition: { domain: 'notes.example.com', kind: 'proxy', port: 8088, root: '', enabled: true } },
    { id: '/etc/nginx/sites-available/default', name: 'default', path: '/etc/nginx/sites-available/default', source: 'server {\n    listen 80 default_server;\n    root /var/www/html;\n    server_name _;\n    location / {\n        try_files $uri $uri/ =404;\n    }\n}\n', revision: 'mock-custom-0', managed: false },
  ];

  async getContainers(): Promise<ContainerSnapshot> { return structuredClone({ status: 'ready', message: '', version: this.engineVersion, containers: this.containers }); }
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
