# Batch Metadata Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Windows desktop app. You drop up to 20 files on it, type metadata
values, and it writes those values into edited copies saved in a folder you
choose.

**Architecture:** One field catalogue (`src/fields.js`) maps each field to a
list of tags for each format family. `src/batch.js` turns the form into a
`{tag: value|null}` map for each file and passes it to one of three writers:
ExifTool, Office (jszip + xmldom) or ID3. Each output is re-read and compared
with what was intended, and the result for each file goes back to a
plain-HTML Electron UI.

**Tech Stack:** Node 22, Electron 45, exiftool-vendored 39, node-id3 0.2,
jszip 3, @xmldom/xmldom 0.9, electron-builder 26, `node:test`, and Playwright
(`_electron`) for the end-to-end test.

**Spec:** `docs/specs/2026-10-28-batch-metadata-editor-design.md`

## Global Constraints

- At most 20 files per batch. The 21st and later are refused, with a count.
- Accepted extensions: .pdf, .docx .docm .dotx .xlsx .xlsm .xltx .pptx .pptm
  .potx, .jpg .jpeg .png .webp .tif .tiff .heic, .mp3, .mp4 .m4a .m4v .mov.
  .doc, .xls and .ppt are refused with "save as .docx/.xlsx/.pptx first".
- Source files are never opened for writing. Every writer copies src → dest
  and then edits dest.
- A blank field means unchanged. `null` (the "clear" tick) means remove.
  "Strip all existing metadata first" is off by default.
- The output folder must not be the source folder of any file in the batch.
- Custom field names must match `/^[A-Za-z][A-Za-z0-9_]{0,63}$/`.
- Name everywhere is "Batch Metadata Editor". appId is
  `com.rcsolax.batchmetadataeditor`. There is no other branding.
- Writers are tested by reading back with ExifTool using `-G1 -a`, with tags
  qualified by group. Unqualified reads merge duplicate tags; the library
  check confirmed this.
- Licences go in `THIRD-PARTY-NOTICES.md`: ExifTool (Artistic/GPL), Electron
  (MIT), jszip (MIT), node-id3 (MIT), @xmldom/xmldom (MIT).

## Review Focus

1. **Non-ASCII text** (`Café — 東京 ✓`) in every format must survive the round
   trip. IPTC needs `-charset iptc=UTF8` and EXIF XP tags are UTF-16. The
   test lives in Task 3/4/5 (`unicode round-trip`).
2. **Windows paths with spaces or accents** (`C:\Users\Ross\Docs\café report.pdf`).
   The test is in Task 6 (`unicode filename`): it copies a fixture to such a
   name and runs the batch.
3. **Two files with the same name from different folders in one batch**
   (`a/report.pdf`, `b/report.pdf`). Both must be written, the second as
   `report (2).pdf`, and nothing is silently overwritten. The test is in
   Task 6.
4. **A corrupt file or one whose extension lies** (text saved as `.jpg`, a
   0-byte `.docx`). That file gets ✗ with a readable reason, and the other
   rows still succeed. The test is in Task 6.
5. **A value the format truncates or rejects** (IPTC ObjectName over 64
   chars, a non-numeric ID3 year). The row is marked ✗ and the field is
   named; it is never reported as ✓. Task 6 tests this through the verify
   step.

---

## File Structure

```
package.json            scripts: start, test, test:e2e, dist; build config
src/formats.js          extension → family; ACCEPTED, REFUSED_LEGACY
src/fields.js           FIELDS catalogue + tagsFor(fieldId, family)
src/values.js           toExif(value, type), normalise(value, type) for compare
src/writers/exiftool.js read/write for pdf | image | media; custom-config generator
src/writers/office.js   read/write for office (core.xml, app.xml, custom.xml)
src/writers/id3.js      read/write for mp3
src/writers/index.js    writerFor(family)
src/batch.js            validateBatch, resolveValues, outputPaths, runBatch
src/presets.js          list/save/load/delete under a given dir
src/main.js             Electron main process + IPC handlers
src/preload.js          contextBridge API (uses webUtils.getPathForFile)
ui/index.html, ui/app.css, ui/app.js   the window
test/fixtures/*         one tiny real file per extension (committed)
test/*.test.js          node:test suites
test/e2e.spec.js        Playwright Electron test
.github/workflows/build.yml   windows-latest: test + dist on tag v*
README.md, THIRD-PARTY-NOTICES.md
```

Format families: `pdf`, `image`, `media` (mp4/m4a/m4v/mov), `office`, `mp3`.

---

### Task 1: Scaffold, formats, fixtures

**Files:**
- Create: `package.json`, `.gitignore`, `src/formats.js`, `test/fixtures/*`, `test/make-fixtures.sh`, `test/formats.test.js`

**Interfaces:**
- Produces: `familyOf(filePath: string) -> 'pdf'|'image'|'media'|'office'|'mp3'|null`, `isLegacyOffice(filePath) -> boolean`, `ACCEPTED: string[]` (lower-case extensions with dot).

- [ ] **Step 1:** `npm init`. Set `"main": "src/main.js"` and scripts `start: electron .`, `test: node --test test/`, `test:e2e: playwright test test/e2e.spec.js`, and `dist: electron-builder --win nsis`. Install deps: `exiftool-vendored node-id3 jszip @xmldom/xmldom`. Install devDeps: `electron electron-builder @playwright/test`.
- [ ] **Step 2:** Write `test/make-fixtures.sh`. It uses PIL, ffmpeg and pdf-lib (`npx -y`) to make `a.jpg a.png a.webp a.tiff a.heic a.mp3 a.m4a a.mp4 a.mov a.pdf` (HEIC via `pip install pillow-heif`), plus a minimal `a.docx a.xlsx a.pptx`. The Office files are built with jszip, contain no docProps, and still open in Office. Commit the outputs; CI never regenerates them. Also commit `corrupt.jpg` (the text "not an image") and `empty.docx` (0 bytes).
- [ ] **Step 3: Failing test** `test/formats.test.js`:
  - `familyOf('C:\\x\\A.PDF') === 'pdf'`
  - `familyOf('a.JPEG') === 'image'`
  - `familyOf('a.m4a') === 'media'`
  - `familyOf('a.xlsm') === 'office'`
  - `familyOf('a.mp3') === 'mp3'`
  - `familyOf('a.txt') === null`
  - `isLegacyOffice('a.doc') === true`
  - `familyOf('a.doc') === null`
- [ ] **Step 4:** Run `npm test`. Expected: FAIL (module missing).
- [ ] **Step 5:** Implement `src/formats.js`.
- [ ] **Step 6:** Run `npm test`. Expected: PASS. Commit with message `scaffold, formats, fixtures`.

### Task 2: Field catalogue

**Files:**
- Create: `src/fields.js`, `src/values.js`, `test/fields.test.js`

**Interfaces:**
- Produces:
  - `FIELDS: Array<{id, label, type, tab, help?, targets: {[family]: string[]}}>`. `type` is one of `text|multiline|list|date|datetime|number|rating|image|gps|bool`. `tab` is `common|pdf|office|image|mp3|media`.
  - `tagsFor(fieldId, family) -> string[]`.
  - `fieldsForTab(tab) -> Field[]`.
  - `values.normalise(v, type) -> string`. Arrays are joined with `"; "`. Numbers become strings. ExifTool dates `YYYY:MM:DD HH:MM:SS(Z)` are reduced to `YYYY-MM-DD` for `date` and to `YYYY-MM-DDTHH:MM` for `datetime`. The result is trimmed.
  - `values.toExif(v, type)`. Dates become `YYYY:MM:DD 00:00:00`. GPS `{lat,lon,alt}` becomes a GPS tag object. Lists become arrays.
- Tag naming: ExifTool tags are written `Group1:Tag` (`PDF:Title`, `XMP-dc:Title`, `IPTC:ObjectName`, `ExifIFD:DateTimeOriginal`, `ItemList:Album`). Office tags are written `core:title`, `app:Company`. MP3 tags use node-id3 keys (`title`, `trackNumber`, `comment`, `image`).
- Content: the full field lists in the spec's **Fields** section. Common fields map across families as follows:
  - **title:** PDF:Title, XMP-dc:Title / IPTC:ObjectName, XMP-dc:Title, IFD0:XPTitle / ItemList:Title / core:title / title
  - **keywords:** PDF:Keywords, XMP-dc:Subject / IPTC:Keywords, XMP-dc:Subject, IFD0:XPKeywords / ItemList:Keyword / core:keywords / (MP3: TXXX `Keywords`)
  - The rest follow the same pattern.

- [ ] **Step 1: Failing tests:**
  - Field ids are unique.
  - Every field has at least one target.
  - Every format-tab field targets only its own family.
  - `tagsFor('title','pdf')` deep-equals `['PDF:Title','XMP-dc:Title']`.
  - `tagsFor('title','office')` deep-equals `['core:title']`.
  - Every family has at least 15 fields.
  - `normalise(['a','b'],'list') === 'a; b'`.
  - `normalise('2026:10:28 00:00:00','date') === '2026-10-28'`.
  - `normalise(2026,'text') === '2026'`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement both files. Spot-check that tag names exist by running `exiftool -listw -XMP-dc:all` and the equivalents for each group.
- [ ] **Step 4:** Run. Expected: PASS. Commit with message `field catalogue`.

### Task 3: ExifTool writer (pdf, image, media)

**Files:**
- Create: `src/writers/exiftool.js`, `test/exiftool.test.js`

**Interfaces:**
- Consumes: `values.toExif`.
- Produces:
  - `openSession({customNames: string[]}) -> Session`. A Session is `{write(src, dest, tags, {strip:boolean}), read(path) -> {[Group1:Tag]: value}, end()}`.
  - `readCurrent(path) -> {[Group1:Tag]: value}`, using a shared instance that has no config.
- Behaviour:
  - A session creates `new ExifTool({exiftoolArgs: ['-config', cfgPath, '-stay_open','True','-@','-']})`.
  - `cfgPath` is a temp file. It defines each custom name under `Image::ExifTool::PDF::Info` and under the `XMP-bme` namespace `http://ns.batchmetadataeditor/1.0/`. The library check proved this layout. Custom tags arrive as `PDF:<name>` and `XMP-bme:<name>`.
  - `write`:
    1. `fs.copyFile(src, dest, COPYFILE_EXCL)`.
    2. If `strip`, run `et.write(dest, {}, {writeArgs:['-all=','-overwrite_original']})`.
    3. Run `et.write(dest, tags, {writeArgs:['-overwrite_original','-charset','iptc=UTF8','-codedcharacterset=utf8']})`.
    - `null` values are passed through as `null`; exiftool-vendored deletes the tag.
  - Errors are rethrown with the file name.

- [ ] **Step 1: Failing tests.** One `describe` per fixture: pdf, jpg, png, webp, tiff, mp4, m4a, mov. Each one:
  - Writes every catalogue tag for its family, using a sample value per type.
  - Reads back with `readRaw(['-G1','-a'])` and asserts each `normalise` matches.
  - Asserts the source file's sha256 is unchanged.
  - Plus:
    - `custom fields`: `PDF:Batch_Ref` and `XMP-bme:Batch_Ref` read back.
    - `clear`: write `IPTC:City:'Hull'`, then write `{ 'IPTC:City': null }` and the tag is absent.
    - `strip`: a jpg with `EXIF:Make` set loses it when `strip:true`.
    - `unicode round-trip`: `Café — 東京 ✓` reads back exactly in XMP-dc:Title, IPTC:ObjectName and IFD0:XPTitle.
    - The dest already existing throws `EEXIST`.

  Any tag the check finds unwritable for a family is removed from that family's targets in `fields.js`, not skipped in the test.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS. Commit with message `exiftool writer`.

### Task 4: Office writer

**Files:**
- Create: `src/writers/office.js`, `test/office.test.js`

**Interfaces:**
- Produces: `write(src, dest, tags, {strip}) -> Promise<void>` and `read(path) -> {[core:x|app:x|custom:x]: value}`.
- Behaviour:
  - Load with jszip and edit with xmldom. Create `docProps/core.xml`, `app.xml` and `custom.xml` when they are missing, adding the matching `[Content_Types].xml` Override and `_rels/.rels` Relationship:
    - core: content type `application/vnd.openxmlformats-package.core-properties+xml`, rel type `http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties`.
    - app: rel type `.../officeDocument/2006/relationships/extended-properties`.
    - custom: rel type `.../officeDocument/2006/relationships/custom-properties`. Each property is `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="N" name="…"><vt:lpwstr>…</vt:lpwstr></property>`, with pid starting at 2.
  - Core elements and their namespaces:
    - dc: title, subject, creator, description, language, identifier
    - cp: keywords, lastModifiedBy, revision, category, contentStatus, version
    - dcterms: created, modified, written with `xsi:type="dcterms:W3CDTF"`
  - `strip` empties all three parts before writing.
  - Generate the zip with `compression:'DEFLATE'`.

- [ ] **Step 1: Failing tests.** For docx, xlsx and pptx:
  - Write every office tag plus `custom:Batch_Ref`.
  - ExifTool `-G1 -a` reads back Title, Company, Manager and Batch_Ref. Group names come from the first test run.
  - `read()` returns the same values.
  - The source sha256 is unchanged.
  - `clear` removes `core:category`.
  - `unicode round-trip`.
  - The output reopens in jszip, and `[Content_Types].xml` contains the core-properties Override exactly once.
  - `empty.docx` rejects with a message containing `not a valid Office file`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS. Commit with message `office writer`.

### Task 5: MP3 writer

**Files:**
- Create: `src/writers/id3.js`, `test/id3.test.js`

**Interfaces:**
- Produces: `write(src, dest, tags, {strip})` and `read(path) -> {[node-id3 key]: value}`.
- Behaviour:
  - Copy src → dest.
  - Set `existing = strip ? {} : NodeID3.read(dest, {noRaw:true})`.
  - Merge the tags into `existing`, deleting any key whose value is null.
  - Custom names become `userDefinedText[{description:name, value}]`.
  - `image` takes a file path and becomes `{mime, type:{id:3}, description:'Cover', imageBuffer}`.
  - Finish with `NodeID3.write(merged, dest)`. If it returns an Error, throw it.

- [ ] **Step 1: Failing tests:**
  - Every mp3 catalogue key round-trips via ExifTool `ID3v2_3:*`. The key → ExifTool name pairs were proven in the library check: `trackNumber`→`Track`, `bpm`→`BeatsPerMinute`, `performerInfo`→`Band`.
  - Cover art: `ID3v2_3:Picture` is present.
  - `clear` removes `album`.
  - `strip` removes a pre-existing `TXXX:Old`.
  - `unicode round-trip`.
  - The source sha256 is unchanged.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS. Commit with message `id3 writer`.

### Task 6: Batch engine

**Files:**
- Create: `src/batch.js`, `src/writers/index.js`, `test/batch.test.js`

**Interfaces:**
- Consumes: `familyOf`, `FIELDS`/`tagsFor`, `normalise`, and the three writers.
- Produces:
  - `validateBatch(paths: string[]) -> {accepted: string[], refused: Array<{path, reason}>}`.
    - Reasons are exact strings: `'Batch is full (20 files max)'`, `'Unsupported file type'`, `'Old Office format: save as .docx/.xlsx/.pptx first'`, `'Already in the batch'`.
  - `resolveValues(form, family, perFileTitle?) -> {[tag]: value|null}`.
    - `form` is `{fields: {[fieldId]: {value, clear}}, custom: Array<{name, value, clear}>}`.
    - Precedence: per-file title, then format-tab field, then common field.
    - Blank (`''`, `[]`, `undefined`) without `clear` is omitted.
  - `outputPaths(paths, outDir, existing: Set<string>) -> Map<src, dest>`.
    - Duplicates inside the batch become `name (2).ext`, `name (3).ext`.
    - A clash with a file already in outDir is left for the UI to resolve: `{conflicts: string[]}`.
  - `runBatch({files: Array<{path, title?}>, form, outDir, strip, onConflict: 'overwrite'|'suffix'}, onProgress) -> Promise<Array<{path, dest, ok, error?, mismatched?: string[]}>>`.
    - Throws `'Output folder is a source folder'` if outDir equals any file's dirname, compared case-insensitively on win32.
    - For each file: write, re-read with the same writer, compare every intended tag via `normalise`, and treat a cleared tag as ok when it is absent.

- [ ] **Step 1: Failing tests:**
  - 21 paths → 20 accepted, 1 refused with `'Batch is full (20 files max)'`.
  - `.doc` → the legacy reason.
  - Per-file title beats the batch title. A format-tab `pdf_title` beats the common title for pdf only.
  - A blank field is omitted. `clear` gives `null`.
  - Two `report.pdf` from different dirs → `report.pdf` and `report (2).pdf`.
  - `unicode filename`: a fixture copied to `café test ø.jpg` (in a temp dir with a space) writes OK.
  - Mixed batch [a.pdf, corrupt.jpg, a.docx, a.mp3]: corrupt fails with a non-empty `error`, and the other 3 are `ok`.
  - An IPTC ObjectName of 80 chars → `ok:false`, with `mismatched` containing `title`.
  - outDir equal to a source dir throws.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Open one ExifTool session per batch (with the custom names) and `end()` it in `finally`.
- [ ] **Step 4:** Run. Expected: PASS. Commit with message `batch engine`.

### Task 7: Electron shell, presets, UI

**Files:**
- Create: `src/main.js`, `src/preload.js`, `src/presets.js`, `ui/index.html`, `ui/app.css`, `ui/app.js`, `test/presets.test.js`

**Interfaces:**
- Consumes: `validateBatch`, `runBatch`, `fieldsForTab`, `readCurrent`/writer `read`.
- Produces the IPC surface `window.bme`:
  - `pathFor(file) -> string` (`webUtils.getPathForFile`; `File.path` no longer exists)
  - `validate(paths)`
  - `fields() -> FIELDS`
  - `readCurrent(path)`
  - `pickOutputFolder() -> string|null` (remembered in userData `settings.json`)
  - `listExisting(dir, names) -> string[]`
  - `apply(job)`, with progress events via `onProgress(cb)`
  - `presets.list()`, `presets.save(name, form)`, `presets.load(name)`, `presets.remove(name)`
- `presets.js` takes `dir` as a constructor argument. Names are sanitised to `[\w -]{1,60}`, and each preset is stored as `<name>.json`.
- Window settings: `contextIsolation:true`, `nodeIntegration:false`, and a CSP that allows only `'self'`.
- UI layout (single window, 1100×760, min 900×600):
  - **Left:** the drop zone and file list. Each row shows an icon by family, the name, a per-file Title input, a remove ✕, and a status cell. The list has a "Clear all" button and the counter `n / 20`.
  - **Right:** tabs Common | PDF | Office | Images | MP3 | Video/M4A | Custom.
    - Each field shows a label, an input by type, and a "clear" checkbox.
    - Tabs for families not in the batch are dimmed but stay editable.
    - The Custom tab has add/remove rows and validates names against the Global Constraints regex inline.
  - **Bottom bar:** the presets dropdown with Save / Delete, the "Strip existing metadata first" checkbox, the output folder label with Change…, and the **Apply** button.
    - Apply is disabled when no files are loaded, or no values are set and strip is off.
    - Clicking a row opens a side drawer that lists `readCurrent` as a table.
  - **Refused drops:** a dismissible notice such as `3 files not added: 2 × Batch is full (20 files max), 1 × Unsupported file type`.
  - **Output conflicts:** a modal with three choices: Overwrite / Add number / Cancel.

- [ ] **Step 1: Failing tests:** presets save → list contains the name → load deep-equals the form → remove → list is empty. A name `../evil` is stored as `evil.json` inside the dir.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement presets, main, preload and the UI.
- [ ] **Step 4:** Run `npm test` (PASS). Then run `xvfb-run npm start` and screenshot the window to check the layout by eye. Commit with message `electron shell, presets, ui`.

### Task 8: End-to-end, packaging, CI, docs

**Files:**
- Create: `test/e2e.spec.js`, `playwright.config.js`, `.github/workflows/build.yml`, `README.md`, `THIRD-PARTY-NOTICES.md`, `build/icon.ico`
- Modify: `package.json` (the `build` block)

**Interfaces:**
- Consumes: the full app.
- Test hook: when `BME_TEST_OUTDIR` is set, `main.js` reads `pickOutputFolder` from it instead of showing a dialog. The variable is read only at startup.

- [ ] **Step 1: Failing e2e test.** Launch with `_electron.launch({args:['.']})`. Feed in [a.pdf, a.docx, a.jpg, a.mp3] via `setInputFiles` on the hidden `<input type=file multiple>` behind the drop zone; drop and pick share one code path. Fill Common Title = `E2E Title`, set Author, and click Apply. Expect 4 rows showing `✓`. ExifTool reads `E2E Title` back from all 4 outputs.
- [ ] **Step 2:** Run `xvfb-run npx playwright test`. Expected: FAIL first, then PASS after any fixes.
- [ ] **Step 3: `package.json` build block:**
  - `appId com.rcsolax.batchmetadataeditor`
  - `productName "Batch Metadata Editor"`
  - `win.target nsis`
  - `nsis {oneClick:false, allowToChangeInstallationDirectory:true}`
  - `files [src/**, ui/**, package.json]`
  - `asarUnpack ["**/node_modules/exiftool-vendored*/**"]`
  - `extraResources THIRD-PARTY-NOTICES.md`
  - Confirm that exiftool-vendored resolves `app.asar.unpacked` when packaged. If it doesn't, pass `exiftoolPath` explicitly.
- [ ] **Step 4: `build.yml`.** On push to main and tags `v*`, run on `windows-latest`: `npm ci`, `npm test`, `npm run dist`. Upload `dist/*.exe` as an artifact. On a tag, also attach it to a GitHub Release.
- [ ] **Step 5: README.** Cover install, the SmartScreen note ("More info → Run anyway"), what each tab writes, the 20-file limit, the legacy Office note, and a "blank = unchanged / tick clear = remove" explanation.
- [ ] **Step 6:** Run `npm test` and `npm run test:e2e` (PASS). Commit with message `e2e, packaging, ci, docs`. Push and confirm that the CI Windows build passes and produces the installer.
