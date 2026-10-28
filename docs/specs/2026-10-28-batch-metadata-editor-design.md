# Batch Metadata Editor — design

Date: 28 Oct 2026. Status: design approved in chat; this spec awaits review.

## Purpose

A standalone Windows desktop app. You drag in a batch of files (at most 20),
type the metadata values you want, and the app writes them into edited
copies of those files. Every value is entered by hand; nothing is guessed or
pulled from anywhere else.

Success means: drop a mixed batch (PDF, Word, JPG, MP3…), fill in the form,
click Apply, and every output file carries exactly the values entered. The
originals are untouched, and the app reports a clear pass or fail for each
file.

## What the user decided

- File types: PDFs, Word/Excel/PowerPoint, images (JPG/PNG/WebP), and
  audio/video (MP3/MP4).
- Fields: every field each format can hold.
- One form for the whole batch, plus an optional per-file Title that
  overrides the batch Title.
- The app saves edited copies to a chosen folder. It never overwrites
  originals.
- Name: Batch Metadata Editor. A standalone app with no connection to any
  other product.

## Stack

Electron (cross-platform, but built and tested for Windows) with three
metadata engines behind one interface:

| Format | Extensions | Engine |
|---|---|---|
| PDF | .pdf | ExifTool (bundled via `exiftool-vendored`) |
| Images | .jpg .jpeg .png .webp .tif .tiff .heic | ExifTool |
| Video / AAC audio | .mp4 .m4a .m4v .mov | ExifTool |
| MP3 | .mp3 | `node-id3` (ExifTool cannot write ID3) |
| Office | .docx .xlsx .pptx (+ macro/template variants) | `jszip` + direct XML edit of `docProps/core.xml`, `app.xml`, `custom.xml` (ExifTool cannot write OOXML) |

Legacy binary Office files (.doc/.xls/.ppt) can't be written reliably by any
free library. The app rejects them on drop, with the message "save as
.docx/.xlsx/.pptx first".

## Units

- `src/formats.js`: maps an extension to its format id. This is the single
  list of what's accepted.
- `src/fields.js`: the field catalogue. Each field has an id, a label, an
  input type (text, multiline, list, date, number, rating, image, GPS), a
  group, and for each format the tag(s) it writes to. Both the UI and the
  writers are built from this one table.
- `src/writers/exiftool.js`, `src/writers/office.js`, `src/writers/id3.js`:
  each exports `read(path)` → `{fieldId: value}` and
  `write(src, dest, values, options)`. The source file is never opened for
  writing: the writer copies src → dest, then edits dest.
- `src/batch.js`: validates the batch (≤ 20 files, supported types, no
  duplicate output names), resolves per-file values (the per-file Title
  overrides the batch Title), runs the writers one file at a time, re-reads
  each output and compares it with what was intended, and returns a result
  for each file.
- `src/main.js` / `src/preload.js`: the Electron shell, with IPC limited to
  `pick-output-folder`, `read-file`, `apply-batch`, and presets save/load.
- `ui/`: plain HTML/CSS/JS with no framework.

## Fields

**Common tab** (written to every format that has an equivalent):
Title, Subject, Description/Comments, Author/Artist/Creator, Keywords/Tags,
Copyright, Company/Publisher, Category/Genre, Rating (0–5), Date created,
Language.

**Format tabs** (one per format family; the full writable set):

- **PDF:** Title, Author, Subject, Keywords, Creator (application), Producer,
  CreationDate, ModDate, Trapped. Also XMP: dc:title/description/creator/
  subject/rights/language/publisher/contributor/source/identifier,
  xmpRights:Marked/WebStatement/UsageTerms, pdf:Keywords.
- **Office:** core: title, subject, creator, keywords, description,
  lastModifiedBy, revision, category, contentStatus, language, identifier,
  version, created, modified. Extended: Company, Manager, HyperlinkBase,
  Template, Application.
- **Images:**
  - EXIF: ImageDescription, Artist, Copyright, Make, Model, Software,
    DateTimeOriginal, CreateDate, UserComment, XPTitle, XPSubject, XPComment,
    XPKeywords, XPAuthor, Rating, GPS latitude/longitude/altitude.
  - IPTC: ObjectName, Headline, Caption-Abstract, Keywords, By-line,
    By-lineTitle, Credit, Source, CopyrightNotice, Contact, City,
    Sub-location, Province-State, Country, Country code, Category,
    SupplementalCategories, SpecialInstructions, Writer-Editor,
    OriginalTransmissionReference, DateCreated.
  - XMP: dc:*, photoshop:*, Iptc4xmpCore:AltTextAccessibility,
    ExtDescrAccessibility, Location, xmpRights:*.
- **MP3 (ID3v2.3, which is what node-id3 writes and what Windows Explorer
  reads best):** title, artist, album, album artist, composer,
  conductor, genre, year, date, track number/total, disc number/total, BPM,
  key, language, publisher, copyright, encoded by, ISRC, comment, lyrics,
  original artist, subtitle, grouping, artist URL, cover art (image file).
- **MP4/M4A/MOV:** title, artist, album, album artist, composer, genre,
  year, track, disc, comment, description, long description, copyright,
  encoder, grouping, keywords, rating, cover art, plus XMP dc:* fields.

**Custom tab:** name/value pairs. These are written as Office custom
properties, PDF Info custom keys, and XMP in images/PDF/MP4 (TXXX frames in
MP3). Names may contain only letters, digits and underscores, and must start
with a letter. PDF Info and XMP can't hold spaces: in the library check, a
key named `Second Key` was written wrongly. Custom PDF/XMP keys need an
ExifTool config, which the app generates for each batch.

The Common and format tabs can both set the same tag. When that happens,
the format-tab value wins, and the UI marks the overridden Common field for
that format.

## Behaviour rules

- **A blank field means "leave unchanged".** Each field has a "clear"
  checkbox that removes the existing value.
- **"Strip all existing metadata first"** is an option, off by default.
  - ExifTool: `-all=` before writing.
  - Office: the property parts are reset.
  - MP3: all frames are removed.
- **Batch limit.** The batch holds at most 20 files. Drops beyond 20 are
  refused, and the app says how many were turned away. Rows can be removed
  individually or all cleared.
- **Output folder.** Chosen on Apply, and remembered. Output keeps the
  original filename. If a file with that name already exists in the output
  folder, the app asks: overwrite, add " (edited)", or cancel. The app
  refuses to use the source folder when that would overwrite an original.
- **Verification.** After writing, each output is re-read and every
  intended field is compared. Each row shows ✓, or ✗ plus the field(s)
  that didn't stick and the engine's error. One failure doesn't stop the
  rest of the batch.
- **Current metadata.** Clicking a row shows the file's existing values in
  a side panel.
- **Presets.** Named field sets saved as JSON in the user's app-data folder.

## Testing

- **Fixtures.** One small real file of each supported extension, generated
  in the test setup: PDF, DOCX/XLSX/PPTX, JPG/PNG/WebP/TIFF, MP3, MP4/M4A.
- **Per writer.** Write every field in its catalogue. Re-read with an
  independent reader (ExifTool reads OOXML and ID3 too) and confirm every
  value. Confirm the source file's SHA-256 hash is unchanged.
- **Batch tests.**
  - The 21st file is refused.
  - Unsupported types are refused.
  - The per-file Title overrides the batch Title.
  - A blank field leaves the existing value in place.
  - "Clear" removes the value.
  - "Strip" removes the old metadata.
  - A single corrupt file fails alone while the rest of the batch
    succeeds.
- **End-to-end.** Launch with Playwright's Electron driver, then: drop
  files → fill the form → Apply → see ✓ rows.

## Build and distribution

- Private GitHub repo `batch-metadata-editor`.
- `npm start` runs the app. `npm run dist` builds a Windows NSIS installer
  with electron-builder (with `exiftool-vendored.exe` unpacked from asar).
- A GitHub Actions workflow on `windows-latest` builds the installer on
  each tagged release. A build uses a few of the free monthly Actions
  minutes for private repos.
- `THIRD-PARTY-NOTICES.md` covers the licences: ExifTool (Perl Artistic/GPL),
  Electron (MIT), jszip (MIT/GPLv3, used under MIT), node-id3 (MIT).
- The installer is unsigned, so Windows SmartScreen will show "More info →
  Run anyway" the first time. Code signing costs money, so it is left out.

## Out of scope

Renaming files, editing file contents, metadata for formats not listed,
batches over 20, and overwriting originals in place.
