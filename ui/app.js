// The window: the file list, the field tabs, presets and Apply.
/* global bme */

const MAX_FILES = 20;
const CUSTOM_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const FAMILY_LABEL = { pdf: 'PDF', office: 'Office', image: 'Images', mp3: 'MP3', media: 'Video' };
const FAMILY_BADGE = { pdf: 'PDF', office: 'DOC', image: 'IMG', mp3: 'MP3', media: 'VID' };
const TAB_FAMILY = { pdf: 'pdf', office: 'office', image: 'image', mp3: 'mp3', media: 'media' };

const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined) n.append(kid);
  return n;
};

const state = {
  files: [], // {path, name, family, title, status: '', result}
  fields: [],
  tabs: [],
  activeTab: 'common',
  outDir: null,
  busy: false,
  // Pre-filled from a file: the value each input started with. A field still
  // equal to it is left alone; emptying it removes the value from the files.
  prefill: null, // { path, values: {fieldId: inputValue}, removedCustom: Set }
};

const sameValue = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');

// ---- Field section headings (derived from the first tag's group) -----------

function sectionOf(field) {
  const fam = Object.keys(field.targets)[0];
  const group = field.targets[fam][0].split(':')[0];
  if (group === 'PDF' || group === 'core') return 'Document properties';
  if (group === 'app') return 'Application properties';
  if (group.startsWith('XMP')) return 'XMP';
  if (group === 'IPTC') return 'IPTC';
  if (['IFD0', 'ExifIFD', 'EXIF', 'GPS'].includes(group)) return 'EXIF';
  if (group === 'ItemList') return 'Tags';
  return fam === 'mp3' ? 'ID3 tags' : 'Other';
}

// ---- Inputs per field type -----------------------------------------------------

function inputFor(field) {
  const id = `f-${field.id}`;
  switch (field.type) {
    case 'multiline':
      return el('textarea', { id, rows: 3 });
    case 'list':
      return el('input', { id, type: 'text', placeholder: 'alpha; beta; gamma' });
    case 'date':
      return el('input', { id, type: 'date' });
    case 'datetime':
      return el('input', { id, type: 'datetime-local' });
    case 'number':
      return el('input', { id, type: 'number', step: 'any' });
    case 'rating':
      return el('select', { id }, el('option', { value: '', text: '—' }),
        ...[0, 1, 2, 3, 4, 5].map((n) => el('option', { value: String(n), text: n ? '★'.repeat(n) : '0 (no stars)' })));
    case 'bool':
      return el('select', { id }, el('option', { value: '', text: '—' }), el('option', { value: 'true', text: 'Yes' }), el('option', { value: 'false', text: 'No' }));
    case 'choice':
      return el('select', { id }, el('option', { value: '', text: '—' }), ...field.options.map((o) => el('option', { value: o, text: o })));
    case 'image': {
      const name = el('span', { class: 'image-name', text: 'No image chosen' });
      const wrap = el('div', { id, class: 'image-pick', 'data-path': '' },
        el('button', { type: 'button', class: 'btn', text: 'Choose image…', onclick: async () => {
          const p = await bme.pickImage();
          if (p) setImage(wrap, p);
        } }),
        name,
        el('button', { type: 'button', class: 'btn btn-quiet', text: 'Remove', onclick: () => setImage(wrap, '') }));
      return wrap;
    }
    case 'gps':
      return el('div', { id, class: 'gps control' },
        el('input', { type: 'number', step: 'any', placeholder: 'Latitude', 'aria-label': 'Latitude', 'data-k': 'lat' }),
        el('input', { type: 'number', step: 'any', placeholder: 'Longitude', 'aria-label': 'Longitude', 'data-k': 'lon' }),
        el('input', { type: 'number', step: 'any', placeholder: 'Altitude (m)', 'aria-label': 'Altitude in metres', 'data-k': 'alt' }));
    default:
      return el('input', { id, type: 'text' });
  }
}

function setImage(wrap, p) {
  wrap.dataset.path = p || '';
  wrap.querySelector('.image-name').textContent = p ? p.split(/[\\/]/).pop() : 'No image chosen';
  onFormChange();
}

function readInput(field) {
  const node = document.getElementById(`f-${field.id}`);
  if (field.type === 'image') return node.dataset.path || '';
  if (field.type === 'gps') {
    const g = Object.fromEntries([...node.querySelectorAll('input')].map((i) => [i.dataset.k, i.value]));
    return g.lat === '' && g.lon === '' ? '' : g;
  }
  return node.value.trim();
}

function writeInput(field, value) {
  const node = document.getElementById(`f-${field.id}`);
  if (field.type === 'image') return setImage(node, value || '');
  if (field.type === 'gps') {
    for (const i of node.querySelectorAll('input')) i.value = (value && value[i.dataset.k]) || '';
    return undefined;
  }
  node.value = Array.isArray(value) ? value.join('; ') : value || '';
  return undefined;
}

function setDisabled(field, disabled) {
  const node = document.getElementById(`f-${field.id}`);
  for (const c of node.matches('input, textarea, select') ? [node] : node.querySelectorAll('input, button')) c.disabled = disabled;
}

// ---- Building the tabs ---------------------------------------------------------

function buildEditor() {
  const tabs = $('#tabs');
  const panels = $('#panels');
  const allTabs = [...state.tabs, { id: 'custom', label: 'Custom' }];
  for (const t of allTabs) {
    tabs.append(el('button', {
      type: 'button', class: 'tab', role: 'tab', id: `tab-${t.id}`, 'aria-controls': `panel-${t.id}`,
      'aria-selected': String(t.id === state.activeTab), 'data-tab': t.id,
      onclick: () => selectTab(t.id),
    }, el('span', { text: t.label }), el('span', { class: 'n', hidden: true })));
    panels.append(el('div', { class: 'panel', role: 'tabpanel', id: `panel-${t.id}`, 'aria-labelledby': `tab-${t.id}`, hidden: t.id !== state.activeTab }));
  }

  // Common
  $('#panel-common').append(el('p', { class: 'panel-note', text: 'Each Common field is written to every format that has an equivalent. A value on a format tab overrides it for that format.' }));
  for (const f of state.fields.filter((x) => x.tab === 'common')) $('#panel-common').append(fieldRow(f));

  // Format tabs, grouped into sections
  for (const t of state.tabs.filter((x) => x.id !== 'common')) {
    const panel = $(`#panel-${t.id}`);
    let current = null;
    for (const f of state.fields.filter((x) => x.tab === t.id)) {
      const s = sectionOf(f);
      if (s !== current) {
        panel.append(el('h3', { class: 'section', text: s }));
        current = s;
      }
      panel.append(fieldRow(f));
    }
  }

  // Custom
  const custom = $('#panel-custom');
  custom.append(
    el('p', { class: 'panel-note', text: 'Your own name/value pairs. Written as: PDF Info + XMP, an Office custom property, XMP in images and video, and a TXXX frame in MP3. Names: letters, digits and _, starting with a letter.' }),
    el('div', { id: 'custom-rows' }),
    el('button', { type: 'button', class: 'btn', text: '+ Add custom field', onclick: () => addCustomRow() }),
  );
}

function fieldRow(f) {
  const input = inputFor(f);
  const clear = el('input', { type: 'checkbox', id: `c-${f.id}`, onchange: (e) => { setDisabled(f, e.target.checked); onFormChange(); } });
  const keep = el('input', { type: 'checkbox', id: `k-${f.id}`, onchange: (e) => { syncKeep(f, e.target.checked); onFormChange(); } });
  const families = Object.keys(f.targets).map((k) => FAMILY_LABEL[k]);
  const meta = el('div', { class: 'meta' },
    el('span', { class: 'status', id: `s-${f.id}` }),
    f.help ? `${f.help} · ` : '',
    f.tab === 'common' ? `Writes to: ${families.join(' · ')}` : `Writes ${f.targets[Object.keys(f.targets)[0]].join(', ').replace(/@file/g, '')}`,
    el('span', { class: 'override', id: `o-${f.id}`, hidden: true }));
  const row = el('div', { class: 'field', id: `row-${f.id}`, 'data-label': `${f.label} ${f.id}`.toLowerCase() },
    el('label', { for: `f-${f.id}`, text: f.label }),
    el('div', { class: 'control' }, input),
    el('div', { class: 'checks' },
      el('label', { class: 'clear', title: 'Remove this value from the files' }, clear, ' Clear'),
      el('label', { class: `keep${isFileDate(f) ? ' no-keep' : ''}`, title: "Keep each file's own value for this field" }, keep, ' Keep')),
    meta);
  row.addEventListener('input', onFormChange);
  row.addEventListener('change', onFormChange);
  return row;
}

function addCustomRow(entry = { name: '', value: '', clear: false }, prefilled = false) {
  const err = el('div', { class: 'err' });
  const name = el('input', { type: 'text', placeholder: 'Name, e.g. Batch_Ref', 'aria-label': 'Custom field name', value: entry.name, maxlength: 64 });
  const value = el('input', { type: 'text', placeholder: 'Value', 'aria-label': 'Custom field value', value: entry.value });
  const clear = el('input', { type: 'checkbox', checked: entry.clear });
  const keep = el('input', { type: 'checkbox', class: 'keep-box' });
  const row = el('div', { class: 'custom-row' }, name, value,
    el('div', { class: 'checks' },
      el('label', { class: 'clear', title: 'Remove this property from the files' }, clear, ' Clear'),
      prefilled ? el('label', { class: 'keep', title: "Keep each file's own value for this property" }, keep, ' Keep') : null),
    el('button', { type: 'button', class: 'btn btn-quiet', 'aria-label': 'Remove this custom field', text: '✕', onclick: () => {
      if (row.dataset.baseName !== undefined && state.prefill) state.prefill.removedCustom.add(row.dataset.baseName);
      row.remove();
      onFormChange();
    } }),
    err);
  if (prefilled) {
    row.dataset.baseName = entry.name;
    row.dataset.baseValue = entry.value;
  }
  const check = () => {
    const bad = name.value !== '' && !CUSTOM_NAME.test(name.value);
    name.classList.toggle('invalid', bad);
    err.textContent = bad ? 'Use letters, digits and _ only, starting with a letter.' : '';
    value.disabled = clear.checked;
  };
  row.addEventListener('input', () => { check(); onFormChange(); });
  row.addEventListener('change', () => { check(); onFormChange(); });
  check();
  $('#custom-rows').append(row);
}

function selectTab(id) {
  state.activeTab = id;
  for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t.dataset.tab === id));
  for (const p of document.querySelectorAll('.panel')) p.hidden = p.id !== `panel-${id}`;
  applyFilter();
}

function applyFilter() {
  const q = $('#filter').value.trim().toLowerCase();
  for (const row of document.querySelectorAll(`#panel-${state.activeTab} .field`)) {
    row.hidden = q !== '' && !row.dataset.label.includes(q);
  }
}

// ---- The form as data ------------------------------------------------------------

// The form as data. By default only what will change the files: with a
// pre-fill, a field left as it was is omitted and an emptied one is a clear.
// { all: true } returns everything visible, for saving as a preset.
function collectForm({ all = false } = {}) {
  const base = !all && state.prefill ? state.prefill : null;
  const fields = {};
  for (const f of state.fields) {
    const clear = document.getElementById(`c-${f.id}`).checked;
    const value = readInput(f);
    if (clear) {
      fields[f.id] = { value: '', clear: true };
    } else if (base && f.id in base.values) {
      if (sameValue(value, base.values[f.id])) continue;
      fields[f.id] = value === '' ? { value: '', clear: true } : { value, clear: false };
    } else if (value !== '') {
      fields[f.id] = { value, clear: false };
    }
  }
  const custom = [];
  for (const row of document.querySelectorAll('.custom-row')) {
    const [nameInput, valueInput] = row.querySelectorAll('input[type=text]');
    const name = nameInput.value.trim();
    const value = valueInput.value;
    const clear = row.querySelector('.clear input').checked;
    const baseName = base ? row.dataset.baseName : undefined;
    if (baseName !== undefined) {
      if (name !== baseName) custom.push({ name: baseName, value: '', clear: true }); // renamed: old one goes
      else if (!clear && value === row.dataset.baseValue) continue;
      else if (!clear && value === '') {
        custom.push({ name, value: '', clear: true });
        continue;
      }
    }
    if (name !== '') custom.push({ name, value, clear });
  }
  if (base) for (const name of base.removedCustom) custom.push({ name, value: '', clear: true });
  if (all || !state.prefill) return { fields, custom };
  // Wipe mode: what each file keeps of its own.
  const keep = {
    fields: state.fields.filter((f) => document.getElementById(`k-${f.id}`).checked).map((f) => f.id),
    custom: [...document.querySelectorAll('.custom-row')]
      .filter((row) => row.dataset.baseName !== undefined && row.querySelector('.keep-box')?.checked)
      .map((row) => row.dataset.baseName),
  };
  return { fields, custom, keep };
}

const isFileDate = (f) => Object.values(f.targets).flat().some((t) => t.startsWith('System:'));

// Fields that write the same tags (Common Title and the PDF tab's Title) are
// one value in the file, so they are kept or not together.
function syncKeep(f, on) {
  const fam = state.prefill && state.prefill.family;
  if (!fam) return;
  const tags = f.targets[fam] || [];
  for (const g of state.fields) {
    if (g !== f && (g.targets[fam] || []).some((t) => tags.includes(t))) document.getElementById(`k-${g.id}`).checked = on;
  }
}

function setAllKeeps(on) {
  for (const f of state.fields) document.getElementById(`k-${f.id}`).checked = on;
  for (const box of document.querySelectorAll('.custom-row .keep-box')) box.checked = on;
  onFormChange();
}

// Changed / kept / wiped counts by value, not by box: boxes that write the
// same tags in the loaded file (Common Title, PDF Title, PDF XMP title) are
// one value there. A group is changed if any box in it is, else kept if any is.
function valueCounts(form) {
  const fam = state.prefill.family;
  const counts = { Changed: 0, Kept: 0, 'Will be wiped': 0 };
  const seen = new Set();
  for (const f of state.fields.filter((x) => !isFileDate(x) && (x.targets[fam] || []).length)) {
    if (seen.has(f.id)) continue;
    const group = [f];
    seen.add(f.id);
    for (let i = 0; i < group.length; i++) {
      const tags = group[i].targets[fam];
      for (const g of state.fields) {
        if (!seen.has(g.id) && (g.targets[fam] || []).some((t) => tags.includes(t))) {
          seen.add(g.id);
          group.push(g);
        }
      }
    }
    const states = group.map((g) => fieldStatus(g, form));
    const st = ['Changed', 'Kept', 'Will be wiped'].find((x) => states.includes(x));
    if (st) counts[st]++;
  }
  return counts;
}

// What happens to each pre-filled field on Apply.
function fieldStatus(f, form) {
  const entry = form.fields[f.id];
  if (entry && !entry.clear) return 'Changed';
  if (isFileDate(f)) return 'Kept';
  const had = (state.prefill.values[f.id] ?? '') !== '' || state.prefill.images.includes(f.id);
  if (document.getElementById(`k-${f.id}`).checked) return had ? 'Kept' : '';
  return had ? 'Will be wiped' : '';
}

function applyForm(form) {
  for (const f of state.fields) {
    const entry = (form.fields || {})[f.id];
    const start = state.prefill && f.id in state.prefill.values ? state.prefill.values[f.id] : '';
    writeInput(f, entry ? (entry.clear ? '' : entry.value) : start);
    const c = document.getElementById(`c-${f.id}`);
    c.checked = Boolean(entry && entry.clear);
    setDisabled(f, c.checked);
  }
  $('#custom-rows').replaceChildren();
  for (const c of form.custom || []) addCustomRow(c);
  onFormChange();
}

function formHasValues(form) {
  return Object.keys(form.fields).length > 0 || form.custom.some((c) => c.clear || c.value !== '');
}

function customNamesValid(form) {
  return form.custom.every((c) => CUSTOM_NAME.test(c.name));
}

// ---- Reacting to edits ------------------------------------------------------------

function onFormChange() {
  const form = collectForm();
  // Tab badges: how many fields are set on each tab.
  for (const t of document.querySelectorAll('.tab')) {
    const n = t.dataset.tab === 'custom'
      ? form.custom.length
      : state.fields.filter((f) => f.tab === t.dataset.tab && form.fields[f.id]).length;
    const badge = t.querySelector('.n');
    badge.hidden = n === 0;
    badge.textContent = String(n);
  }
  for (const f of state.fields) document.getElementById(`row-${f.id}`).classList.toggle('filled', Boolean(form.fields[f.id]));

  const wipe = Boolean(state.prefill);
  document.body.classList.toggle('wipe-mode', wipe);
  $('#strip').disabled = wipe;
  if (wipe) $('#strip').checked = true;
  for (const f of state.fields) {
    const st = document.getElementById(`s-${f.id}`);
    const text = wipe ? fieldStatus(f, form) : '';
    st.textContent = text;
    st.dataset.state = text.split(' ')[0].toLowerCase();
  }

  // Common fields overridden by a format-tab field for some families.
  for (const f of state.fields.filter((x) => x.tab === 'common')) {
    const note = document.getElementById(`o-${f.id}`);
    const over = [];
    if (form.fields[f.id]) {
      for (const [fam, tags] of Object.entries(f.targets)) {
        const hit = state.fields.some((g) => g.tab === fam && form.fields[g.id] && g.targets[fam].some((t) => tags.includes(t)));
        if (hit) over.push(FAMILY_LABEL[fam]);
      }
    }
    note.hidden = over.length === 0;
    note.textContent = over.length ? ` Overridden for ${over.join(', ')} by a format tab.` : '';
  }
  updateApply();
}

function updateApply() {
  const form = collectForm();
  const ready = state.files.length > 0 && (formHasValues(form) || $('#strip').checked || Boolean(state.prefill)) && customNamesValid(form);
  $('#apply').disabled = state.busy || !ready;
  $('#apply').title = !state.files.length ? 'Add some files first'
    : !customNamesValid(form) ? 'Fix the custom field names first'
      : !ready ? (state.prefill ? 'Change at least one value' : 'Enter at least one value') : '';
}

// ---- Files ------------------------------------------------------------------------

// ---- Pre-filling from a file -------------------------------------------------------

async function loadDetails(file, { confirm = true } = {}) {
  if (confirm && formHasValues(collectForm())) {
    const sure = await ask({
      title: `Fill the form from ${file.name}?`,
      text: 'This replaces what is in the form now.',
      buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Replace', value: 'ok', primary: true }],
    });
    if (sure !== 'ok') return;
  }
  let data;
  // Busy while reading, so nothing typed or applied meanwhile is overwritten.
  setBusy(true);
  try {
    data = await bme.prefill(file.path);
  } catch (e) {
    showNotice(`Could not read ${file.name}: ${ipcMessage(e)}`);
    return;
  } finally {
    setBusy(false);
  }
  const values = {};
  for (const f of state.fields) {
    writeInput(f, data.fields[f.id] ?? '');
    const c = document.getElementById(`c-${f.id}`);
    c.checked = false;
    setDisabled(f, false);
    values[f.id] = readInput(f);
  }
  $('#custom-rows').replaceChildren();
  for (const c of data.custom) addCustomRow({ ...c, clear: false }, true);
  for (const f of state.fields) document.getElementById(`k-${f.id}`).checked = false;
  for (const id of data.images || []) {
    const pick = document.getElementById(`f-${id}`);
    if (pick) pick.querySelector('.image-name').textContent = 'Has a picture: tick Keep to keep it';
  }
  state.prefill = { path: file.path, family: file.family, values, images: data.images || [], removedCustom: new Set() };
  onFormChange();
  showNotice(`Filled in the details from ${file.name}. On Apply, each copy keeps only what you change and what you tick Keep. Everything else is wiped, including details that have no box here.`, {
    success: true,
    action: el('button', { type: 'button', class: 'btn', text: 'Keep all', onclick: () => setAllKeeps(true) }),
  });
}

// The file the form was filled from has left the batch: its untouched values
// would otherwise sit in the form looking as if they applied to the others.
function dropPrefillIfGone() {
  const p = state.prefill;
  if (!p || state.files.some((f) => f.path === p.path)) return;
  for (const f of state.fields) {
    if (f.id in p.values && sameValue(readInput(f), p.values[f.id])) writeInput(f, '');
  }
  for (const row of document.querySelectorAll('.custom-row')) {
    const [name, value] = row.querySelectorAll('input[type=text]');
    if (row.dataset.baseName !== undefined && name.value.trim() === row.dataset.baseName && value.value === row.dataset.baseValue) row.remove();
    else {
      delete row.dataset.baseName;
      delete row.dataset.baseValue;
    }
  }
  state.prefill = null;
  for (const f of state.fields) document.getElementById(`k-${f.id}`).checked = false;
  $('#strip').checked = false;
  onFormChange();
}

async function addPaths(paths) {
  if (!paths.length || state.busy) return;
  const wasEmpty = state.files.length === 0;
  const { accepted, refused } = await bme.validate(paths, state.files.map((f) => f.path));
  for (const a of accepted) state.files.push({ ...a, title: '', status: '', result: null });
  renderFiles();
  // One file on its own: start the form from what it already holds.
  if (wasEmpty && state.files.length === 1 && !refused.length && !formHasValues(collectForm())) {
    await loadDetails(state.files[0], { confirm: false });
    return;
  }
  if (refused.length) {
    const counts = {};
    for (const r of refused) counts[r.reason] = (counts[r.reason] || 0) + 1;
    const parts = Object.entries(counts).map(([reason, n]) => `${n} × ${reason}`);
    showNotice(`${refused.length} file${refused.length > 1 ? 's' : ''} not added: ${parts.join(', ')}`);
  } else {
    hideNotice();
  }
}

function renderFiles() {
  const list = $('#file-list');
  list.replaceChildren(...state.files.map((f, i) => {
    const title = el('input', {
      type: 'text', class: 'file-title', value: f.title, placeholder: 'Title for this file (optional)',
      'aria-label': `Title for ${f.name}`, oninput: (e) => { f.title = e.target.value; },
    });
    const status = el('div', { class: 'file-status', 'aria-live': 'polite' });
    let cls = 'file';
    if (f.status === 'working') status.textContent = 'Writing…';
    if (f.result) {
      cls += f.result.ok ? ' ok' : ' bad';
      status.textContent = f.result.ok ? `✓ Saved as ${f.result.dest.split(/[\\/]/).pop()}` : `✗ ${f.result.error}`;
      if (f.result.skipped && f.result.skipped.length) {
        const labels = f.result.skipped.map((id) => (state.fields.find((x) => x.id === id) || { label: id }).label);
        status.append(el('span', { class: 'skipped', text: `Not supported by this file type, so skipped: ${labels.join(', ')}` }));
      }
    }
    return el('li', { class: cls, 'data-path': f.path },
      el('span', { class: 'badge', text: FAMILY_BADGE[f.family] }),
      el('button', { type: 'button', class: 'file-name', title: `${f.path}\nClick to see its current metadata`, text: f.name, onclick: () => openDrawer(f) }),
      el('button', { type: 'button', class: 'btn btn-quiet load', text: 'Load details', title: `Fill the form from ${f.name}`, disabled: state.busy, onclick: () => loadDetails(f) }),
      el('button', { type: 'button', class: 'btn btn-quiet', 'aria-label': `Remove ${f.name}`, text: '✕', disabled: state.busy, onclick: () => { state.files.splice(i, 1); renderFiles(); dropPrefillIfGone(); } }),
      title,
      status);
  }));
  const n = state.files.length;
  $('#count').textContent = `${n} / ${MAX_FILES}`;
  $('#count').classList.toggle('full', n >= MAX_FILES);
  $('#clear-all').disabled = n === 0 || state.busy;
  $('#dropzone').classList.toggle('compact', n > 0);
  for (const t of document.querySelectorAll('.tab')) {
    const fam = TAB_FAMILY[t.dataset.tab];
    const present = !fam || n === 0 || state.files.some((f) => f.family === fam);
    t.classList.toggle('dim', !present);
    t.title = present ? '' : 'No files of this type in the batch';
  }
  updateApply();
}

// ---- Notices, drawer, dialog ----------------------------------------------------------

function showNotice(text, { success = false, action = null } = {}) {
  const n = $('#notice');
  n.className = `notice${success ? ' success' : ''}`;
  n.replaceChildren(el('span', { text }),
    el('span', {}, action, el('button', { type: 'button', class: 'btn btn-quiet', 'aria-label': 'Dismiss', text: '✕', onclick: hideNotice })));
  n.hidden = false;
}
function hideNotice() {
  $('#notice').hidden = true;
}

async function openDrawer(file) {
  $('#drawer-title').textContent = file.name;
  $('#drawer-body').replaceChildren(el('p', { class: 'panel-note', text: 'Reading…' }));
  $('#drawer-filter').value = '';
  $('#drawer').hidden = false;
  try {
    const data = await bme.readCurrent(file.path);
    const rows = Object.entries(data).sort(([a], [b]) => a.localeCompare(b));
    $('#drawer-body').replaceChildren(rows.length
      ? el('table', {}, el('tbody', {}, ...rows.map(([k, v]) => el('tr', { 'data-q': `${k} ${v}`.toLowerCase() },
        el('td', { text: k }), el('td', { text: Array.isArray(v) ? v.join('; ') : String(v) })))))
      : el('p', { class: 'panel-note', text: 'This file has no metadata the app can read.' }));
  } catch (e) {
    $('#drawer-body').replaceChildren(el('p', { class: 'panel-note', text: `Could not read this file: ${e.message}` }));
  }
  $('#drawer-close').focus();
}

// Resolves with the clicked button's value (or the input's text for prompts).
function ask({ title, text = '', buttons, input = null }) {
  return new Promise((resolve) => {
    const d = $('#dialog');
    $('#dialog-title').textContent = title;
    $('#dialog-text').textContent = text;
    const field = $('#dialog-input');
    field.hidden = input === null;
    field.value = input || '';
    // Enter in the text box means OK, not the first button (Cancel).
    field.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        d.close('ok');
      }
    };
    $('#dialog-actions').replaceChildren(...buttons.map((b) => el('button', {
      type: 'submit', value: b.value, class: `btn${b.primary ? ' btn-primary' : ''}`, text: b.label,
    })));
    d.onclose = () => {
      const v = d.returnValue;
      resolve(input !== null && v === 'ok' ? field.value.trim() : v);
    };
    d.returnValue = 'cancel';
    d.showModal();
    (input !== null ? field : d.querySelector('.btn-primary') || d.querySelector('button')).focus();
  });
}

// ---- Presets --------------------------------------------------------------------------

async function refreshPresets(selected = '') {
  const names = await bme.presets.list();
  $('#preset-select').replaceChildren(el('option', { value: '', text: 'Presets…' }),
    ...names.map((n) => el('option', { value: n, text: n, selected: n === selected })));
  $('#preset-delete').disabled = !selected;
}

// ---- Output folder and Apply ----------------------------------------------------------

function setOutDir(dir) {
  state.outDir = dir;
  $('#out-dir').textContent = dir || 'Not chosen';
  $('#out-dir').title = dir || '';
}

function setBusy(busy) {
  state.busy = busy;
  document.body.classList.toggle('busy', busy);
  renderFiles();
}

const ipcMessage = (e) => String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

async function apply() {
  try {
    await runApply();
  } catch (e) {
    showNotice(ipcMessage(e));
  }
}

async function runApply() {
  const form = collectForm();
  if (!state.outDir) {
    const dir = await bme.pickOutputFolder();
    if (!dir) return;
    setOutDir(dir);
  }

  // Also refuses a missing folder, or one holding any of the originals.
  const conflicts = await bme.planOutputs(state.files.map((f) => f.path), state.outDir);
  const wipe = Boolean(state.prefill);
  if (wipe) {
    const counts = valueCounts(form);
    const sure = await ask({
      title: 'Wipe everything you have not changed or kept?',
      text: `Each copy keeps ${counts.Changed} changed and ${counts.Kept} kept value${counts.Kept === 1 ? '' : 's'}.\n`
        + `${counts['Will be wiped']} other value${counts['Will be wiped'] === 1 ? '' : 's'} shown here, and any details with no box here, will be removed.\n`
        + 'Photo rotation, colour profile and the file dates stay. Your original files are not touched.',
      buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Wipe and save', value: 'ok', primary: true }],
    });
    if (sure !== 'ok') return;
  }
  let onConflict = 'suffix';
  if (conflicts.length) {
    const shown = conflicts.slice(0, 6).join('\n') + (conflicts.length > 6 ? `\n…and ${conflicts.length - 6} more` : '');
    const choice = await ask({
      title: `${conflicts.length} file${conflicts.length > 1 ? 's' : ''} already in that folder`,
      text: shown,
      buttons: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Overwrite', value: 'overwrite' },
        { label: 'Add “(edited)”', value: 'suffix', primary: true },
      ],
    });
    if (choice === 'cancel') return;
    onConflict = choice;
  }

  for (const f of state.files) {
    f.status = '';
    f.result = null;
  }
  hideNotice();
  setBusy(true);
  const stop = bme.onProgress((p) => {
    const f = state.files.find((x) => x.path === p.path);
    if (!f) return;
    f.status = p.status;
    if (p.result) f.result = p.result;
    renderFiles();
  });
  try {
    const results = await bme.apply({
      files: state.files.map((f) => ({ path: f.path, title: f.title.trim() })),
      form: { fields: form.fields, custom: form.custom }, outDir: state.outDir, strip: $('#strip').checked, onConflict,
      wipe, keep: form.keep || { fields: [], custom: [] },
    });
    for (const r of results) {
      const f = state.files.find((x) => x.path === r.path);
      if (f) f.result = r;
    }
    const ok = results.filter((r) => r.ok).length;
    const dir = state.outDir;
    showNotice(`${ok} of ${results.length} file${results.length > 1 ? 's' : ''} saved${ok < results.length ? ' — see the ✗ rows for why' : ''}.`, {
      success: ok === results.length,
      action: el('button', { type: 'button', class: 'btn', text: 'Open folder', onclick: () => bme.openFolder(dir) }),
    });
  } finally {
    stop();
    setBusy(false);
  }
}

// ---- Wiring -----------------------------------------------------------------------------

function wire() {
  const dz = $('#dropzone');
  // Stop the window navigating to a file dropped anywhere outside the zone.
  for (const ev of ['dragover', 'drop']) document.addEventListener(ev, (e) => e.preventDefault());
  dz.addEventListener('dragenter', () => dz.classList.add('over'));
  dz.addEventListener('dragover', (e) => { e.dataTransfer.dropEffect = 'copy'; dz.classList.add('over'); });
  dz.addEventListener('dragleave', (e) => { if (!dz.contains(e.relatedTarget)) dz.classList.remove('over'); });
  dz.addEventListener('drop', (e) => {
    dz.classList.remove('over');
    addPaths([...e.dataTransfer.files].map((f) => bme.pathFor(f)).filter(Boolean));
  });
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#add-files').click(); } });
  $('#add-files').addEventListener('click', async (e) => {
    e.stopPropagation();
    addPaths(await bme.pickFiles());
  });
  $('#file-input').addEventListener('change', (e) => {
    addPaths([...e.target.files].map((f) => bme.pathFor(f)));
    e.target.value = '';
  });
  $('#clear-all').addEventListener('click', () => { state.files = []; renderFiles(); hideNotice(); dropPrefillIfGone(); });

  $('#filter').addEventListener('input', applyFilter);
  $('#keep-all').addEventListener('click', () => setAllKeeps(true));
  $('#keep-none').addEventListener('click', () => setAllKeeps(false));
  $('#strip').addEventListener('change', updateApply);
  $('#out-change').addEventListener('click', async () => {
    const dir = await bme.pickOutputFolder();
    if (dir) setOutDir(dir);
  });
  $('#apply').addEventListener('click', apply);

  $('#drawer-close').addEventListener('click', () => { $('#drawer').hidden = true; });
  $('#drawer-filter').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    for (const tr of document.querySelectorAll('#drawer-body tr')) tr.hidden = q !== '' && !tr.dataset.q.includes(q);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#drawer').hidden) $('#drawer').hidden = true; });

  $('#preset-select').addEventListener('change', async (e) => {
    const name = e.target.value;
    $('#preset-delete').disabled = !name;
    if (name) applyForm(await bme.presets.load(name));
  });
  $('#preset-save').addEventListener('click', async () => {
    const name = await ask({
      title: 'Save as preset',
      text: 'Saves every field and custom value on all tabs, so this set can be loaded again in one click.',
      input: $('#preset-select').value || '',
      buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Save', value: 'ok', primary: true }],
    });
    if (!name || name === 'cancel') return;
    try {
      const saved = await bme.presets.save(name, collectForm({ all: true }));
      await refreshPresets(saved);
    } catch (e) {
      showNotice(ipcMessage(e));
    }
  });
  $('#preset-delete').addEventListener('click', async () => {
    const name = $('#preset-select').value;
    if (!name) return;
    const sure = await ask({
      title: `Delete preset “${name}”?`,
      buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Delete', value: 'ok', primary: true }],
    });
    if (sure !== 'ok') return;
    await bme.presets.remove(name);
    await refreshPresets();
  });
}

async function init() {
  const { fields, tabs } = await bme.fields();
  state.fields = fields;
  state.tabs = tabs;
  buildEditor();
  wire();
  renderFiles();
  setOutDir(await bme.getOutputFolder());
  await refreshPresets();
  onFormChange();
}

init();
