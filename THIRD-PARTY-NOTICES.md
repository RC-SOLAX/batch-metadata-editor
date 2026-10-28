# Third-party notices

Batch Metadata Editor includes the following software. Each remains under its
own licence.

| Component | Licence | Use |
|---|---|---|
| [ExifTool](https://exiftool.org) by Phil Harvey | Same terms as Perl: Artistic License or GPL v1+ | Reads and writes PDF, image and video metadata |
| [exiftool-vendored](https://github.com/photostructure/exiftool-vendored.js), exiftool-vendored.exe, exiftool-vendored.pl | MIT | Bundles and drives ExifTool |
| [batch-cluster](https://github.com/photostructure/batch-cluster.js) | MIT | ExifTool process management |
| [luxon](https://github.com/moment/luxon), @types/luxon | MIT | Date handling (via exiftool-vendored) |
| [@photostructure/tz-lookup](https://github.com/photostructure/tz-lookup) | CC0-1.0 | Time-zone lookup (via exiftool-vendored) |
| [he](https://github.com/mathiasbynens/he) | MIT | HTML entities (via exiftool-vendored) |
| [Electron](https://www.electronjs.org) | MIT (bundles Chromium; see LICENSES.chromium.html in the install folder) | Application shell |
| [JSZip](https://stuk.github.io/jszip/) | MIT (dual MIT/GPL-3.0; used under MIT) | Opens Word, Excel and PowerPoint files |
| [pako](https://github.com/nodeca/pako) | MIT and Zlib | Compression (via JSZip) |
| lie, immediate, setimmediate, readable-stream, core-util-is, isarray, process-nextick-args, safe-buffer, string_decoder, util-deprecate, inherits | MIT / ISC | Support libraries (via JSZip) |
| [@xmldom/xmldom](https://github.com/xmldom/xmldom) | MIT | Edits Office property XML |
| [node-id3](https://github.com/Zazama/node-id3) | MIT | Reads and writes MP3 (ID3) tags |
| [iconv-lite](https://github.com/ashtuchkin/iconv-lite), safer-buffer | MIT | Text encodings (via node-id3) |

ExifTool source and licence: https://exiftool.org/#license
