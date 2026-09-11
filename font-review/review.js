const rows = [...document.querySelectorAll('.candidate')];
const boxes = new Map(rows.map((row) => [row.dataset.id, row.querySelector('input')]));
const count = document.querySelector('#selection-count');
const status = document.querySelector('#save-status');
const token = document.querySelector('meta[name="review-token"]').content;
const connected = Boolean(token);
const pending = new Map();
let state = { version: 1, revision: 0, selected: [], updatedAt: null };
let queue = Promise.resolve();
let reportTimer;

function reportRender() {
  if (!connected) return;
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => {
    const report = {
      rows: rows.length,
      loadedFonts: rows.filter((row) => row.dataset.fontStatus === 'loaded').length,
      boundCheckboxes: rows.filter((row) => row.dataset.saveBound === 'true').length,
      sourceFontPreviews: rows.filter((row) => {
        const sample = row.querySelector('.sample');
        const style = getComputedStyle(sample);
        return row.dataset.fontStatus === 'loaded' && style.visibility === 'visible'
          && style.fontFamily.includes(row.dataset.face) && sample.getBoundingClientRect().width > 0;
      }).length,
      checkedCount: [...boxes.values()].filter((box) => box.checked).length,
      pendingSaves: pending.size, revision: state.revision,
      fontErrors: rows.filter((row) => row.dataset.fontStatus === 'error').map((row) => row.dataset.label).slice(0, 5),
    };
    void fetch('/api/render-status', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Token': token },
      body: JSON.stringify(report),
    }).then(responseJSON).catch((error) => message(`The local checklist connection failed: ${error.message}`, true));
  }, 100);
}

function message(text, error = false) {
  status.textContent = text;
  status.dataset.error = String(error);
}

function show(next) {
  if (next.revision >= state.revision) state = next;
  let selected = 0;
  for (const row of rows) {
    const id = row.dataset.id;
    const checked = pending.has(id) ? pending.get(id) : state.selected.includes(id);
    boxes.get(id).checked = checked;
    row.dataset.selected = String(checked);
    if (checked) selected++;
  }
  count.textContent = `${selected} selected`;
  reportRender();
}

async function responseJSON(response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'The font selection could not be saved.');
  return body;
}

for (const row of rows) {
  const id = row.dataset.id;
  const box = boxes.get(id);
  box.addEventListener('change', () => {
    const checked = box.checked;
    if (!connected) {
      const selected = new Set(state.selected);
      if (checked) selected.add(id);
      else selected.delete(id);
      show({ ...state, selected: [...selected], revision: state.revision + 1, updatedAt: new Date().toISOString() });
      message('Preview only. Download your selections before closing this file.');
      return;
    }
    pending.set(id, checked);
    box.disabled = true;
    show(state);
    message('Saving...');
    const save = queue.then(async () => {
      try {
        const saved = await responseJSON(await fetch('/api/selection', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Token': token },
          body: JSON.stringify({ id, checked }),
        }));
        pending.delete(id);
        show(saved);
        if (!pending.size) message('Saved to font-review/selection.json');
      } catch (error) {
        pending.delete(id);
        show(state);
        message(`Could not save ${row.dataset.label}: ${error.message} Please retry.`, true);
      } finally {
        box.disabled = row.dataset.fontStatus !== 'loaded';
      }
    });
    queue = save;
  });
  row.dataset.saveBound = 'true';
}

if (connected) {
  show(JSON.parse(document.querySelector('#initial-selection').textContent));
  message('Saved to font-review/selection.json');
  const events = new EventSource('/events');
  events.onmessage = (event) => show(JSON.parse(event.data));
  events.onerror = () => message('The local connection was interrupted. Reopen the checklist before continuing.', true);
  events.onopen = () => { if (!pending.size) message('Saved to font-review/selection.json'); };
  window.addEventListener('pagehide', () => events.close());
} else {
  show(state);
  message('Preview only. Use the app checklist for automatic saving, or download your picks.');
}

document.querySelector('#download-selection').addEventListener('click', async () => {
  await queue;
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(state, null, 2)}\n`], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'font-selection.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

async function loadFonts() {
  let loaded = 0;
  for (const row of rows) {
    try {
      const faces = await document.fonts.load(`400 30px "${row.dataset.face}"`, row.querySelector('.sample').textContent);
      if (faces.length !== 1 || faces[0].status !== 'loaded') throw new Error('The source font did not load.');
      row.dataset.fontStatus = 'loaded';
      boxes.get(row.dataset.id).disabled = pending.has(row.dataset.id);
      loaded++;
    } catch (error) {
      row.dataset.fontStatus = 'error';
      row.querySelector('.sample').textContent = `Font unavailable: ${error.message}`;
      row.querySelector('.sample').classList.add('font-error');
    }
  }
  document.querySelector('#font-count').textContent = `${loaded} / 100 fonts loaded`;
  if (loaded !== 100) message('Some font files could not load. Those choices are disabled rather than showing a fallback.', true);
  reportRender();
}
void loadFonts();
