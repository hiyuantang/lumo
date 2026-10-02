// SPDX-License-Identifier: AGPL-3.0-only
package desktopapps

const NotesJS = `// SPDX-License-Identifier: AGPL-3.0-only
const root = document.getElementById('app');
root.innerHTML = '<header><h1></h1><p>A note saved on your server.</p></header><p><textarea id="note" aria-label="Note" rows="10" maxlength="12000" disabled></textarea></p><button id="save" disabled>Save</button><p id="status" role="status">Loading</p>';
root.querySelector('h1').textContent = TITLE;
const note = document.getElementById('note');
const save = document.getElementById('save');
const status = document.getElementById('status');
let snapshot;
let savedText = '';
note.addEventListener('input', () => { lumo.setDirty(note.value !== savedText); save.disabled = note.value === savedText; status.textContent = note.value === savedText ? 'Saved' : 'Unsaved changes'; });
save.onclick = async () => {
  const text = note.value;
  save.disabled = true; note.disabled = true; status.textContent = 'Saving';
  try {
    snapshot = await lumo.call('app.storage.set', { revision: snapshot.revision, value: { ...snapshot.value, text } });
    savedText = text; lumo.setDirty(false); status.textContent = 'Saved';
  } catch (error) {
    status.textContent = error.code === 'conflict' ? 'The saved note changed elsewhere. Copy your edits before reopening the app.' : error.message + ' Your edits are still here; copy them before reopening.';
  } finally { note.disabled = false; save.disabled = note.value === savedText; }
};
(async () => {
  try {
    snapshot = await lumo.call('app.storage.get');
    if (snapshot.value !== null && (typeof snapshot.value !== 'object' || typeof snapshot.value.text !== 'string')) throw new Error('Saved data has an unsupported format. It has been preserved.');
    savedText = snapshot.value?.text ?? ''; note.value = savedText; note.disabled = false; status.textContent = 'Saved'; lumo.ready();
  } catch (error) { status.textContent = error.message; }
})();
`
