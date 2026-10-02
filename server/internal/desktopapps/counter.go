// SPDX-License-Identifier: AGPL-3.0-only
package desktopapps

const CounterJS = `// SPDX-License-Identifier: AGPL-3.0-only
const root = document.getElementById('app');
root.innerHTML = '<header><h1></h1><p>Save a count across visits.</p></header><section class="cards"><article><span>Count</span><strong id="count">—</strong></article></section><button id="add" disabled>Add one</button> <button id="reload" disabled>Reload saved count</button><p id="status" role="status">Loading</p>';
root.querySelector('h1').textContent = TITLE;
let snapshot;
const status = document.getElementById('status');
function busy(value) { document.getElementById('add').disabled = value; document.getElementById('reload').disabled = value; }
function render(next) {
  const value = next.value === null ? { count: 0 } : next.value;
  if (!value || !Number.isSafeInteger(value.count) || value.count < 0) throw new Error('Saved data has an unsupported format. It has been preserved.');
  snapshot = { revision: next.revision, value };
  document.getElementById('count').textContent = String(value.count);
}
async function reload() {
  busy(true);
  try { render(await lumo.call('app.storage.get')); status.textContent = 'Saved count loaded'; busy(false); lumo.ready(); }
  catch(error) { status.textContent = error.message; document.getElementById('reload').disabled = false; }
}
document.getElementById('reload').onclick = reload;
document.getElementById('add').onclick = async () => {
  busy(true);
  try {
    if (!Number.isSafeInteger(snapshot.value.count + 1)) throw new Error('The counter has reached its limit.');
    render(await lumo.call('app.storage.set', { revision: snapshot.revision, value: { ...snapshot.value, count: snapshot.value.count + 1 } }));
    status.textContent = 'Saved'; busy(false);
  } catch(error) {
    status.textContent = error.code === 'conflict' ? 'Changed in another window. Reload the saved count before adding again.' : error.message + ' Reload the saved count before trying again.';
    document.getElementById('reload').disabled = false;
  }
};
reload();
`
