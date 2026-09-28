// SPDX-License-Identifier: AGPL-3.0-only
import { test as base, expect } from '@playwright/test';
export * from '@playwright/test';

const local = (value: string) => {
  const url = new URL(value);
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
};

export const test = base.extend<{ offlineNetwork: void }>({
  offlineNetwork: [async ({ context }, use) => {
    if (process.env.LUMO_TEST_ONLINE === '1') { await use(); return; }
    const blocked: string[] = [];
    await context.route('**/*', (route) => {
      if (local(route.request().url())) return route.continue();
      blocked.push(new URL(route.request().url()).origin);
      return route.abort('blockedbyclient');
    });
    await context.routeWebSocket(/.*/, (socket) => {
      if (local(socket.url())) { socket.connectToServer(); return; }
      blocked.push(new URL(socket.url()).origin);
      socket.close({ code: 1008, reason: 'External networking is disabled in tests' });
    });
    await use();
    expect(blocked, 'Offline tests must not contact external services').toEqual([]);
  }, { auto: true }],
});
