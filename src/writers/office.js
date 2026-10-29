// Office writer (.docx/.xlsx/.pptx and their macro/template variants).
//
// Document properties live in three XML parts inside the zip:
//   docProps/core.xml    core:<element>   title, creator, keywords, dates...
//   docProps/app.xml     app:<element>    Company, Manager, HyperlinkBase...
//   docProps/custom.xml  custom:<name>   user-defined name/value pairs
// A part that is missing is created, along with its [Content_Types].xml
// override and its package relationship.

const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const { splitList } = require('../values');

const NS = {
  cp: 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
  dc: 'http://purl.org/dc/elements/1.1/',
  dcterms: 'http://purl.org/dc/terms/',
  dcmitype: 'http://purl.org/dc/dcmitype/',
  xsi: 'http://www.w3.org/2001/XMLSchema-instance',
  app: 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties',
  custom: 'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties',
  vt: 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  rels: 'http://schemas.openxmlformats.org/package/2006/relationships',
};

const PARTS = {
  core: {
    defaultPath: 'docProps/core.xml',
    contentType: 'application/vnd.openxmlformats-package.core-properties+xml',
    relType: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
    empty: `<cp:coreProperties xmlns:cp="${NS.cp}" xmlns:dc="${NS.dc}" xmlns:dcterms="${NS.dcterms}" xmlns:dcmitype="${NS.dcmitype}" xmlns:xsi="${NS.xsi}"/>`,
  },
  app: {
    defaultPath: 'docProps/app.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
    relType: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
    empty: `<Properties xmlns="${NS.app}" xmlns:vt="${NS.vt}"/>`,
  },
  custom: {
    defaultPath: 'docProps/custom.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.custom-properties+xml',
    relType: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties',
    empty: `<Properties xmlns="${NS.custom}" xmlns:vt="${NS.vt}"/>`,
  },
};

// core:<name> -> the namespace prefix it lives under.
const CORE_PREFIX = {
  title: 'dc', subject: 'dc', creator: 'dc', description: 'dc', language: 'dc', identifier: 'dc',
  keywords: 'cp', lastModifiedBy: 'cp', revision: 'cp', category: 'cp', contentStatus: 'cp', version: 'cp',
  created: 'dcterms', modified: 'dcterms',
};
const DATE_ELEMENTS = new Set(['created', 'modified']);
const CUSTOM_FMTID = '{D5CDD505-2E9C-101B-9397-08002B2CF9AE}';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const parse = (xml) => new DOMParser().parseFromString(xml, 'text/xml');
const serialise = (doc) => {
  const xml = new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, '');
  return XML_DECL + xml;
};
const elements = (node) => Array.from(node.childNodes).filter((n) => n.nodeType === 1);

// Form date/datetime ("2026-10-28" or "2026-10-28T09:30", local time) -> W3CDTF UTC.
function toW3C(v) {
  const s = String(v).trim();
  const d = new Date(/T/.test(s) ? s : `${s}T00:00`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${s}`);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// W3CDTF UTC -> local "YYYY-MM-DDTHH:MM", the shape the form uses.
function fromW3C(s) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function toText(v) {
  return Array.isArray(v) ? splitList(v).join('; ') : String(v);
}

async function loadZip(file) {
  try {
    return await JSZip.loadAsync(fs.readFileSync(file));
  } catch (e) {
    throw new Error(`${path.basename(file)} is not a valid Office file (${e.message})`);
  }
}

function relsDoc(zip) {
  return zip.file('_rels/.rels').async('string').then(parse);
}

// The zip path of a docProps part, found through the package relationships.
function partPath(rels, part) {
  const rel = Array.from(rels.getElementsByTagName('Relationship')).find((r) => r.getAttribute('Type') === PARTS[part].relType);
  return rel ? rel.getAttribute('Target').replace(/^\//, '') : null;
}

async function loadPart(zip, rels, part) {
  const p = partPath(rels, part);
  const f = p && zip.file(p);
  return f ? parse(await f.async('string')) : null;
}

function registerPart(zip, rels, ct, part) {
  const target = PARTS[part].defaultPath;
  const types = ct.documentElement;
  const already = Array.from(types.getElementsByTagName('Override')).some((o) => o.getAttribute('PartName') === `/${target}`);
  if (!already) {
    const o = ct.createElementNS(NS.ct, 'Override');
    o.setAttribute('PartName', `/${target}`);
    o.setAttribute('ContentType', PARTS[part].contentType);
    types.appendChild(o);
  }
  const root = rels.documentElement;
  const ids = new Set(Array.from(root.getElementsByTagName('Relationship')).map((r) => r.getAttribute('Id')));
  let n = 1;
  while (ids.has(`rId${n}`)) n++;
  const r = rels.createElementNS(NS.rels, 'Relationship');
  r.setAttribute('Id', `rId${n}`);
  r.setAttribute('Type', PARTS[part].relType);
  r.setAttribute('Target', target);
  root.appendChild(r);
  return target;
}

function setCore(doc, name, value) {
  const prefix = CORE_PREFIX[name];
  if (!prefix) throw new Error(`Unknown core property: ${name}`);
  const root = doc.documentElement;
  const existing = elements(root).find((e) => e.namespaceURI === NS[prefix] && e.localName === name);
  if (value === null) {
    if (existing) root.removeChild(existing);
    return;
  }
  const el = existing || root.appendChild(doc.createElementNS(NS[prefix], `${prefix}:${name}`));
  while (el.firstChild) el.removeChild(el.firstChild);
  if (DATE_ELEMENTS.has(name)) {
    el.setAttributeNS(NS.xsi, 'xsi:type', 'dcterms:W3CDTF');
    el.appendChild(doc.createTextNode(toW3C(value)));
  } else {
    el.appendChild(doc.createTextNode(toText(value)));
  }
}

function setApp(doc, name, value) {
  const root = doc.documentElement;
  const existing = elements(root).find((e) => e.localName === name);
  if (value === null) {
    if (existing) root.removeChild(existing);
    return;
  }
  const el = existing || root.appendChild(doc.createElementNS(NS.app, name));
  while (el.firstChild) el.removeChild(el.firstChild);
  el.appendChild(doc.createTextNode(toText(value)));
}

function setCustom(doc, name, value) {
  const root = doc.documentElement;
  const existing = elements(root).find((e) => e.getAttribute('name') === name);
  if (existing) root.removeChild(existing);
  if (value === null) return;
  const prop = doc.createElementNS(NS.custom, 'property');
  prop.setAttribute('fmtid', CUSTOM_FMTID);
  prop.setAttribute('name', name);
  const v = doc.createElementNS(NS.vt, 'vt:lpwstr');
  v.appendChild(doc.createTextNode(toText(value)));
  prop.appendChild(v);
  root.appendChild(prop);
  // pids must be unique and start at 2.
  elements(root).forEach((p, i) => p.setAttribute('pid', String(i + 2)));
}

const SETTERS = { core: setCore, app: setApp, custom: setCustom };

// Strip one part, leaving only the properties named in keep ("core:title",
// "app:Company", "custom:Ref").
function pruneTo(doc, part, keep) {
  const root = doc.documentElement;
  for (const el of elements(root)) {
    const key = part === 'custom' ? `custom:${el.getAttribute('name')}` : `${part}:${el.localName}`;
    if (!keep.has(key)) root.removeChild(el);
  }
  if (part === 'custom') elements(root).forEach((p, i) => p.setAttribute('pid', String(i + 2)));
}

async function write(src, dest, tags, { strip = false, keep = [] } = {}) {
  const keepSet = new Set(keep);
  fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
  try {
    const zip = await loadZip(dest);
    if (!zip.file('[Content_Types].xml') || !zip.file('_rels/.rels')) {
      throw new Error(`${path.basename(dest)} is not a valid Office file (no package parts)`);
    }
    const ct = parse(await zip.file('[Content_Types].xml').async('string'));
    const rels = await relsDoc(zip);
    let packageChanged = false;

    // Group the tags by part; null still counts (it clears).
    const byPart = { core: {}, app: {}, custom: {} };
    for (const [tag, value] of Object.entries(tags)) {
      const [part, ...rest] = tag.split(':');
      if (!byPart[part]) throw new Error(`Unknown Office tag: ${tag}`);
      byPart[part][rest.join(':')] = value;
    }

    for (const part of Object.keys(PARTS)) {
      const wanted = Object.keys(byPart[part]).length > 0;
      let doc = await loadPart(zip, rels, part);
      if (!doc && !wanted) continue;
      let target = partPath(rels, part);
      if (!doc) {
        doc = parse(PARTS[part].empty);
        if (!target) {
          target = registerPart(zip, rels, ct, part);
          packageChanged = true;
        }
      } else if (strip) {
        pruneTo(doc, part, keepSet);
      }
      for (const [name, value] of Object.entries(byPart[part])) SETTERS[part](doc, name, value);
      zip.file(target, serialise(doc));
    }

    if (packageChanged) {
      zip.file('[Content_Types].xml', serialise(ct));
      zip.file('_rels/.rels', serialise(rels));
    }
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(dest, buf);
  } catch (e) {
    fs.rmSync(dest, { force: true });
    throw e;
  }
  return { warnings: [] };
}

async function read(file) {
  const zip = await loadZip(file);
  const out = {};
  if (!zip.file('_rels/.rels')) return out;
  const rels = await relsDoc(zip);
  const core = await loadPart(zip, rels, 'core');
  if (core) {
    for (const el of elements(core.documentElement)) {
      const text = el.textContent;
      out[`core:${el.localName}`] = DATE_ELEMENTS.has(el.localName) ? fromW3C(text) : text;
    }
  }
  const app = await loadPart(zip, rels, 'app');
  if (app) {
    for (const el of elements(app.documentElement)) {
      if (elements(el).length === 0) out[`app:${el.localName}`] = el.textContent;
    }
  }
  const custom = await loadPart(zip, rels, 'custom');
  if (custom) {
    for (const el of elements(custom.documentElement)) {
      out[`custom:${el.getAttribute('name')}`] = el.textContent;
    }
  }
  return out;
}

module.exports = { write, read };
