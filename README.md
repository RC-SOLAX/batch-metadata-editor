# Batch Metadata Editor

A Windows desktop app for editing file metadata in batches. Drop in up to 20
files, type the values you want, and click **Apply to files**. The app saves
edited copies to a folder you choose. Your original files are never changed.

## Install

Download `Batch-Metadata-Editor-Setup-<version>.exe` from the latest
[release](../../releases), or from the **Build** workflow's artifacts, and
run it.

The installer isn't code-signed. The first time you run it, Windows
SmartScreen says it "protected your PC". Click **More info**, then **Run
anyway**.

## What it edits

| Files | Where the values go |
|---|---|
| PDF (.pdf) | Document properties (Title, Author, Subject, Keywords, Creator, Producer, dates, Trapped), each written to both the Info dictionary and its XMP twin, as Word and Acrobat do; plus further XMP fields |
| Word, Excel, PowerPoint (.docx .xlsx .pptx and the macro/template variants) | File › Info properties: core, extended (Company, Manager, Hyperlink base…) and custom |
| Images (.jpg .png .webp .tif .heic) | EXIF (including the Windows title, tags, comments and author fields, plus GPS), IPTC (JPEG and TIFF only), XMP (including alt text) |
| MP3 (.mp3) | ID3v2.3 tags, including album, track, disc, lyrics, ISRC, rating and cover art |
| Video and AAC audio (.mp4 .m4a .m4v .mov) | iTunes-style tags (title, artist, album, genre, track, cover art…) and XMP |

Old Office formats (.doc, .xls, .ppt) are turned away. Open them in Office
and save them as .docx, .xlsx or .pptx first.

## Using it

1. **Add files.** Drag them onto the drop area, or click **Add files…**. The
   batch holds up to 20. Anything over the limit, or of a type the app can't
   edit, is turned away, and the app tells you how many and why.
2. **Fill in the fields.** If the batch holds a single file, the form fills
   in with whatever that file already has: title, author, dates, tags and so
   on. In a larger batch, click **Load details** on any file to do the same.
   Only the boxes you change are written, so anything you leave as it was
   stays exactly as it is in the file and is never copied onto the other
   files. Emptying a pre-filled box removes that value.
   The fields:
   - **Common** fields go to every file type that has an equivalent. For
     example, Title becomes the PDF title, the Word title, the image title
     and the MP3 title.
   - Each **format tab** (PDF, Office, Images, MP3, Video / M4A) lists every
     field that format can hold. A value entered there overrides the Common
     value for that format.
   - **File created** and **File modified** (top of the Common tab) set the
     dates Windows shows in a file's Properties › General and in Explorer.
     If left as they are, each copy keeps its original's dates.
     These are the file's own dates, separate from the dates stored inside a
     document, which programs like Acrobat show. Creation dates can be set on
     Windows only.
   - **Custom** holds your own name/value pairs, such as `Batch_Ref = 2026-114`.
   - Each file row has its own optional **Title** box, which overrides the
     batch title for that file only.
3. **Blank means unchanged.** A field you leave empty doesn't touch the
   file. Tick **Clear** beside a field to remove that value from the files.
   Tick **Remove all existing metadata first** to wipe everything before
   your values are written. Photos keep their rotation and colour profile,
   because those decide how the picture looks. In PDFs, stripped or cleared
   values are removed for good: the file is rewritten, not just patched.
4. **Apply.** Choose the output folder. It can't be a folder the originals
   are in. If a file with the same name is already there, you choose
   whether to overwrite it or add " (edited)" to the new copy's name.
5. **Check the ticks.** After writing, the app reads every copy back. A
   row shows ✓ only if every value really went in. Otherwise it shows ✗ and
   names the fields that didn't take, along with the reason. Fields a file
   type can't hold (such as IPTC in a PNG) are listed as skipped.

Click a file's name to see the metadata it holds now. **Save as preset…**
saves the whole form, so a set of values you use often is one click away
next time.

## Development

```
npm install
npm start            # run the app
npm test             # unit and integration tests
npm run test:e2e     # drives the real app with Playwright
npm run dist         # build the Windows installer into dist/
```

`test/make-fixtures.sh` regenerates the sample files in `test/fixtures`. The
Office checks in the tests use a small standard-library Python reader
(`test/helpers/read_office.py`), so Python 3 must be on the PATH.
