"""Independent Office property reader for the tests (Python stdlib only).
Prints {"core:title": ..., "app:Company": ..., "custom:Name": ...} as JSON."""
import json, sys, zipfile
import xml.etree.ElementTree as ET

out = {}
with zipfile.ZipFile(sys.argv[1]) as z:
    names = z.namelist()
    if 'docProps/core.xml' in names:
        for el in ET.fromstring(z.read('docProps/core.xml')):
            out['core:' + el.tag.split('}')[1]] = el.text or ''
    if 'docProps/app.xml' in names:
        for el in ET.fromstring(z.read('docProps/app.xml')):
            if len(el) == 0:
                out['app:' + el.tag.split('}')[1]] = el.text or ''
    if 'docProps/custom.xml' in names:
        for el in ET.fromstring(z.read('docProps/custom.xml')):
            out['custom:' + el.get('name')] = el[0].text or ''
    out['__content_types'] = z.read('[Content_Types].xml').decode('utf-8')
    out['__rels'] = z.read('_rels/.rels').decode('utf-8')
print(json.dumps(out))
