// SPDX-License-Identifier: AGPL-3.0-only
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const [entry, authPath, operation, providerId, method] = process.argv.slice(1);
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\n');
const controller = new AbortController();
const pending = new Map();
let sequence = 0;
const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  try {
    const reply = JSON.parse(line);
    const resolve = pending.get(reply.id);
    if (resolve && typeof reply.value === 'string') resolve(reply.value);
  } catch {}
});
lines.on('close', () => { if (operation !== 'list') controller.abort(); });
process.on('SIGTERM', () => controller.abort());
const safeURL = (value) => { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : undefined; } catch { return undefined; } };
try {
  const { ModelRuntime } = await import(pathToFileURL(entry).href);
  const runtime = await ModelRuntime.create({ authPath, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false, signal: controller.signal });
  if (operation === 'list') {
    const credentials = await runtime.listCredentials({ signal: controller.signal });
    emit({ providers: runtime.getProviders().map((provider) => ({
      id: provider.id, name: provider.name,
      methods: [provider.auth?.oauth && { type: 'oauth', label: provider.auth.oauth.loginLabel || 'Sign in with browser' }, provider.auth?.apiKey?.login && { type: 'api_key', label: 'API key' }].filter(Boolean),
      credential: credentials.find((item) => item.providerId === provider.id)?.type,
    })).sort((a, b) => a.name.localeCompare(b.name)) });
  } else if (operation === 'logout') {
    if (!runtime.getProvider(providerId)) throw new Error();
    await runtime.logout(providerId, { signal: controller.signal });
    emit({ type: 'done' });
  } else {
    const provider = runtime.getProvider(providerId);
    if (!provider || (method !== 'oauth' && method !== 'api_key') || !(method === 'oauth' ? provider.auth?.oauth : provider.auth?.apiKey)?.login) throw new Error();
    await runtime.login(providerId, method, {
      signal: controller.signal,
      notify(event) {
        if (event.type === 'auth_url') emit({ type: 'event', event: { type: event.type, url: safeURL(event.url), message: event.instructions } });
        if (event.type === 'device_code') emit({ type: 'event', event: { type: event.type, url: safeURL(event.verificationUri), code: event.userCode } });
        if (event.type === 'info' || event.type === 'progress') emit({ type: 'event', event: { type: event.type, message: event.message, links: event.links?.map((link) => ({ url: safeURL(link.url), label: link.label })).filter((link) => link.url) } });
      },
      prompt(prompt) {
        const id = String(++sequence);
        return new Promise((resolve, reject) => {
          const finish = (error, value) => {
            if (!pending.has(id)) return;
            pending.delete(id);
            controller.signal.removeEventListener('abort', abort);
            prompt.signal?.removeEventListener('abort', abort);
            emit({ type: 'prompt_end', id });
            if (error) reject(error); else resolve(value);
          };
          const abort = () => finish(new Error('Cancelled'));
          pending.set(id, (value) => {
            if (prompt.type === 'select' && !prompt.options.some((option) => option.id === value)) return;
            if (prompt.type === 'secret' && (!value.trim() || /^[!$]/.test(value.trim()) || /[\r\n\0]/.test(value))) return;
            finish(null, value);
          });
          controller.signal.addEventListener('abort', abort, { once: true });
          prompt.signal?.addEventListener('abort', abort, { once: true });
          if (controller.signal.aborted || prompt.signal?.aborted) { abort(); return; }
          emit({ type: 'prompt', prompt: { id, type: prompt.type, message: prompt.message, placeholder: prompt.placeholder, options: prompt.type === 'select' ? prompt.options.map(({ id, label }) => ({ id, label })) : undefined } });
        });
      },
    });
    emit({ type: 'done' });
  }
} catch (error) {
  if (error?.name === 'CredentialSynchronizationError') emit({ type: 'done' });
  else emit({ type: 'error', message: controller.signal.aborted ? 'Sign-in cancelled.' : 'Pi could not complete provider setup. Check your details and try again.' });
} finally {
  lines.close();
  process.exit(0);
}
