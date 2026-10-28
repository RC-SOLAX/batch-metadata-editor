#!/usr/bin/env bash
# Regenerates test/fixtures. Needs python3 (Pillow, pillow-heif, python-docx,
# openpyxl, python-pptx), ffmpeg and node. The outputs are committed; CI never
# runs this.
set -euo pipefail
cd "$(dirname "$0")/fixtures"
python3 - <<'PY'
from PIL import Image
import pillow_heif, docx, openpyxl, pptx, zipfile, re
pillow_heif.register_heif_opener()
im = Image.new('RGB', (16, 16), (200, 50, 50))
for ext in ['jpg', 'png', 'webp', 'tiff', 'heic']:
    im.save('a.' + ext)
d = docx.Document(); d.add_paragraph('Fixture'); d.save('a.docx')
wb = openpyxl.Workbook(); wb.active['A1'] = 'Fixture'; wb.save('a.xlsx')
p = pptx.Presentation(); p.slides.add_slide(p.slide_layouts[6]); p.save('a.pptx')
# bare.docx: the same document with every docProps part removed, so the
# writer's "create the part" path is exercised.
with zipfile.ZipFile('a.docx') as src, zipfile.ZipFile('bare.docx', 'w', zipfile.ZIP_DEFLATED) as dst:
    for item in src.infolist():
        if item.filename.startswith('docProps/'):
            continue
        data = src.read(item.filename)
        if item.filename == '[Content_Types].xml':
            data = re.sub(rb'<Override PartName="/docProps/[^"]+"[^>]*/>', b'', data)
        if item.filename == '_rels/.rels':
            data = re.sub(rb'<Relationship [^>]*Target="docProps/[^"]+"[^>]*/>', b'', data)
        dst.writestr(item, data)
PY
ffmpeg -loglevel error -y -f lavfi -i sine=d=1 a.mp3
ffmpeg -loglevel error -y -f lavfi -i sine=d=1 -c:a aac a.m4a
ffmpeg -loglevel error -y -f lavfi -i color=c=red:s=32x32:d=1 -f lavfi -i sine=d=1 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest a.mp4
ffmpeg -loglevel error -y -f lavfi -i color=c=red:s=32x32:d=1 -c:v libx264 -pix_fmt yuv420p a.mov
node -e "
const {PDFDocument}=require('pdf-lib');
(async()=>{const d=await PDFDocument.create();d.addPage([200,200]);require('fs').writeFileSync('a.pdf',await d.save())})()"
printf 'not an image\n' > corrupt.jpg
: > empty.docx
ls -la

# Review-fix fixtures.
# oriented.jpg: rotated (Orientation 6), an sRGB ICC profile, and a camera Make.
python3 - <<'PY'
from PIL import Image, ImageCms
im = Image.new('RGB', (16, 8), (20, 120, 200))
icc = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
exif = Image.Exif(); exif[0x0112] = 6; exif[0x010F] = 'OldCam'
im.save('oriented.jpg', icc_profile=icc, exif=exif.tobytes())
PY
# secret.pdf: Author and Title that a strip must remove for good.
node -e "
const {PDFDocument}=require('pdf-lib');
(async()=>{const d=await PDFDocument.create();d.addPage([200,200]);d.setAuthor('SECRETPERSON');d.setTitle('Old');
require('fs').writeFileSync('secret.pdf',await d.save())})()"
# v24.mp3: an ID3v2.4 tag with a recording time (TDRC), as Picard/foobar write.
ffmpeg -loglevel error -y -i a.mp3 -c copy -id3v2_version 4 -metadata date=2019-05-01 -metadata title=Old v24.mp3
