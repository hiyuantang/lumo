// SPDX-License-Identifier: AGPL-3.0-only
const pending = new Map();
let port;
let serial = 0;
let rendered = false;
let dirty = false;
function report(status, message = '') {
  if (port) port.postMessage({ type: 'report', status, message: String(message).slice(0, 2000) });
}
globalThis.lumo = Object.freeze({
  call(method, params) {
    return new Promise((resolve, reject) => {
      if (!port) return reject(new Error('App connection unavailable.'));
      if (pending.size >= 8) return reject(new Error('Too many requests.'));
      const id = ++serial;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Request timed out.')); }, 10000);
      pending.set(id, { resolve, reject, timer });
      try { port.postMessage({ type: 'call', id, method, params }); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  },
  setDirty(value) {
    if (typeof value !== 'boolean') throw new Error('setDirty expects a boolean.');
    if (dirty === value) return;
    dirty = value;
    if (port) port.postMessage({ type: 'dirty', value });
  },
  ready() { rendered = true; report('ready'); },
});
addEventListener('message', function connect(event) {
  if (event.source !== parent || event.data?.type !== 'lumo-connect' || !event.ports[0] || port) return;
  port = event.ports[0];
  port.onmessage = ({ data }) => {
    if (data?.type === 'theme') {
      document.documentElement.dataset.theme = data.theme;
      document.documentElement.dataset.motion = data.motion;
      return;
    }
    const request = pending.get(data?.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(data.id);
    if (data.error) request.reject(Object.assign(new Error(data.error), { code: data.code }));
    else request.resolve(data.value);
  };
  port.start();
  if (dirty) port.postMessage({ type: 'dirty', value: dirty });
  dispatchEvent(new Event('lumo-connected'));
  if (rendered) report('ready');
});
addEventListener('error', (event) => report('error', event.message));
addEventListener('unhandledrejection', (event) => report('error', event.reason?.message || event.reason));
parent.postMessage({type:'lumo-ready'}, '*');
