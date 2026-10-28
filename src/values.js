// Value conversion. normalise() turns a value written or read back into one
// comparable string; toExif() turns a form value into what ExifTool expects.

const splitList = (v) =>
  (Array.isArray(v) ? v : String(v).split(/\s*[;,]\s*/))
    .map((s) => String(s).trim())
    .filter(Boolean);

// "2026:10:28 09:30:00+01:00" | "2026-10-28T09:30:00Z" -> ["2026-10-28", "09:30"]
function dateParts(v) {
  const m = String(v).trim().match(/^(\d{4})[:-](\d{2})[:-](\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return [`${m[1]}-${m[2]}-${m[3]}`, m[4] ? `${m[4]}:${m[5]}` : '00:00'];
}

function normalise(v, type) {
  if (v === undefined || v === null || v === '') return '';
  switch (type) {
    case 'list':
      return splitList(v).join('; ');
    case 'date': {
      const p = dateParts(v);
      return p ? p[0] : String(v).trim();
    }
    case 'datetime': {
      const p = dateParts(v);
      return p ? `${p[0]}T${p[1]}` : String(v).trim();
    }
    case 'number':
    case 'rating':
      return String(Number(v));
    case 'bool':
      return String(v).toLowerCase() === 'true' ? 'true' : 'false';
    case 'choice':
      return String(v).trim().toLowerCase();
    case 'image':
      return 'present';
    case 'gps': {
      const n = (x) => (x === undefined || x === null || x === '' ? '' : Number(x).toFixed(5));
      return `${n(v.lat)},${n(v.lon)},${n(v.alt)}`;
    }
    default:
      return (Array.isArray(v) ? v.map(String).join('; ') : String(v)).trim();
  }
}

function toExif(v, type) {
  if (v === null || v === undefined) return v;
  switch (type) {
    case 'list':
      return splitList(v);
    case 'date': {
      const p = dateParts(v);
      return p ? `${p[0].replace(/-/g, ':')} 00:00:00` : v;
    }
    case 'datetime': {
      const p = dateParts(v);
      return p ? `${p[0].replace(/-/g, ':')} ${p[1]}:00` : v;
    }
    case 'bool':
      return v === true || String(v).toLowerCase() === 'true' ? 'True' : 'False';
    case 'number':
    case 'rating':
      return Number(v);
    default:
      return v;
  }
}

module.exports = { normalise, toExif, splitList, dateParts };
