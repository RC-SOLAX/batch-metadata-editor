// The field catalogue: every field the app can write, and for each format
// family the tags it writes to. The UI and the writers are both built from
// this table.
//
// Tag naming by family:
//   pdf, image, media  ExifTool "Group1:Tag" (PDF:Title, XMP-dc:Title, IPTC:City)
//   office             core:<element> / app:<element> in docProps
//   mp3                node-id3 keys (title, trackNumber, ...); TXXX:<name>
//                      for user-defined text frames
// Two pseudo-tags are expanded by the ExifTool writer: EXIF:GPS (an
// {lat, lon, alt} object) and <Group>:<Tag>@file (a binary written from a file).
//
// Types: text, multiline, list, date, datetime, number, rating, bool, choice,
// image (a file path), gps.

const FAMILY_TABS = { pdf: 'pdf', office: 'office', image: 'image', mp3: 'mp3', media: 'media' };

const TABS = [
  { id: 'common', label: 'Common' },
  { id: 'pdf', label: 'PDF' },
  { id: 'office', label: 'Office' },
  { id: 'image', label: 'Images' },
  { id: 'mp3', label: 'MP3' },
  { id: 'media', label: 'Video / M4A' },
];

const common = (id, label, type, targets, extra = {}) => ({ id, label, type, tab: 'common', targets, ...extra });

// A format-tab field: one family, its own tags.
const only = (tab) => (id, label, type, tags, extra = {}) => ({
  id: `${tab}_${id}`, label, type, tab, targets: { [FAMILY_TABS[tab]]: [].concat(tags) }, ...extra,
});
const pdf = only('pdf');
const office = only('office');
const image = only('image');
const mp3 = only('mp3');
const media = only('media');

const FIELDS = [
  // ---- Common: written to every format with an equivalent -----------------
  common('title', 'Title', 'text', {
    pdf: ['PDF:Title', 'XMP-dc:Title'],
    image: ['XMP-dc:Title', 'IPTC:ObjectName', 'IFD0:XPTitle'],
    media: ['ItemList:Title', 'XMP-dc:Title'],
    office: ['core:title'],
    mp3: ['title'],
  }),
  common('subject', 'Subject', 'text', {
    pdf: ['PDF:Subject'],
    image: ['IFD0:XPSubject'],
    office: ['core:subject'],
    mp3: ['subtitle'],
  }),
  common('description', 'Description / comments', 'multiline', {
    pdf: ['XMP-dc:Description'],
    image: ['XMP-dc:Description', 'IPTC:Caption-Abstract', 'IFD0:ImageDescription', 'IFD0:XPComment'],
    media: ['ItemList:Description', 'ItemList:Comment', 'XMP-dc:Description'],
    office: ['core:description'],
    mp3: ['comment'],
  }),
  common('author', 'Author / artist / creator', 'text', {
    pdf: ['PDF:Author', 'XMP-dc:Creator'],
    image: ['XMP-dc:Creator', 'IPTC:By-line', 'IFD0:Artist', 'IFD0:XPAuthor'],
    media: ['ItemList:Artist', 'XMP-dc:Creator'],
    office: ['core:creator'],
    mp3: ['artist'],
  }),
  common('keywords', 'Keywords / tags', 'list', {
    pdf: ['PDF:Keywords', 'XMP-dc:Subject'],
    image: ['XMP-dc:Subject', 'IPTC:Keywords', 'IFD0:XPKeywords'],
    media: ['ItemList:Keyword', 'XMP-dc:Subject'],
    office: ['core:keywords'],
    mp3: ['TXXX:Keywords'],
  }, { help: 'Separate with ; or ,' }),
  common('copyright', 'Copyright', 'text', {
    pdf: ['XMP-dc:Rights'],
    image: ['XMP-dc:Rights', 'IPTC:CopyrightNotice', 'IFD0:Copyright'],
    media: ['ItemList:Copyright', 'XMP-dc:Rights'],
    office: ['custom:Copyright'],
    mp3: ['copyright'],
  }),
  common('publisher', 'Company / publisher', 'text', {
    pdf: ['XMP-dc:Publisher'],
    image: ['XMP-dc:Publisher'],
    media: ['XMP-dc:Publisher'],
    office: ['app:Company'],
    mp3: ['publisher'],
  }),
  common('category', 'Category / genre', 'text', {
    pdf: ['XMP-photoshop:Category'],
    media: ['ItemList:Genre'],
    office: ['core:category'],
    mp3: ['genre'],
  }),
  common('rating', 'Rating (0–5)', 'rating', {
    pdf: ['XMP-xmp:Rating'],
    image: ['XMP-xmp:Rating', 'IFD0:Rating'],
    media: ['XMP-xmp:Rating'],
    mp3: ['rating'],
  }),
  common('created', 'Date created', 'date', {
    pdf: ['PDF:CreateDate', 'XMP-xmp:CreateDate'],
    image: ['ExifIFD:DateTimeOriginal', 'ExifIFD:CreateDate', 'XMP-xmp:CreateDate', 'IPTC:DateCreated'],
    media: ['QuickTime:CreateDate', 'XMP-xmp:CreateDate'],
    office: ['core:created'],
  }),
  common('language', 'Language', 'text', {
    pdf: ['XMP-dc:Language'],
    image: ['XMP-dc:Language'],
    media: ['XMP-dc:Language'],
    office: ['core:language'],
  }, { help: 'e.g. en-GB' }),

  // ---- PDF ------------------------------------------------------------------
  pdf('title', 'Title', 'text', 'PDF:Title'),
  pdf('author', 'Author', 'text', 'PDF:Author'),
  pdf('subject', 'Subject', 'text', 'PDF:Subject'),
  pdf('keywords', 'Keywords', 'list', 'PDF:Keywords'),
  pdf('creator', 'Creator (application)', 'text', 'PDF:Creator'),
  pdf('producer', 'Producer', 'text', 'PDF:Producer'),
  pdf('createdate', 'Created', 'datetime', 'PDF:CreateDate'),
  pdf('modifydate', 'Modified', 'datetime', 'PDF:ModifyDate'),
  pdf('trapped', 'Trapped', 'choice', 'PDF:Trapped', { options: ['True', 'False', 'Unknown'] }),
  pdf('xmp_title', 'XMP title', 'text', 'XMP-dc:Title'),
  pdf('xmp_description', 'XMP description', 'multiline', 'XMP-dc:Description'),
  pdf('xmp_creator', 'XMP creators', 'list', 'XMP-dc:Creator'),
  pdf('xmp_subject', 'XMP subject keywords', 'list', 'XMP-dc:Subject'),
  pdf('xmp_rights', 'XMP rights', 'text', 'XMP-dc:Rights'),
  pdf('xmp_language', 'XMP language', 'text', 'XMP-dc:Language'),
  pdf('xmp_publisher', 'XMP publisher', 'text', 'XMP-dc:Publisher'),
  pdf('xmp_contributor', 'XMP contributors', 'list', 'XMP-dc:Contributor'),
  pdf('xmp_source', 'XMP source', 'text', 'XMP-dc:Source'),
  pdf('xmp_identifier', 'XMP identifier', 'text', 'XMP-dc:Identifier'),
  pdf('xmp_pdfkeywords', 'XMP PDF keywords', 'text', 'XMP-pdf:Keywords'),
  pdf('rights_marked', 'Copyrighted (rights marked)', 'bool', 'XMP-xmpRights:Marked'),
  pdf('rights_webstatement', 'Rights web statement (URL)', 'text', 'XMP-xmpRights:WebStatement'),
  pdf('rights_usageterms', 'Usage terms', 'multiline', 'XMP-xmpRights:UsageTerms'),

  // ---- Office -----------------------------------------------------------------
  office('title', 'Title', 'text', 'core:title'),
  office('subject', 'Subject', 'text', 'core:subject'),
  office('creator', 'Authors', 'text', 'core:creator'),
  office('keywords', 'Tags', 'list', 'core:keywords'),
  office('description', 'Comments', 'multiline', 'core:description'),
  office('lastmodifiedby', 'Last modified by', 'text', 'core:lastModifiedBy'),
  office('revision', 'Revision number', 'number', 'core:revision'),
  office('category', 'Categories', 'text', 'core:category'),
  office('contentstatus', 'Content status', 'text', 'core:contentStatus', { help: 'e.g. Draft, Final' }),
  office('language', 'Language', 'text', 'core:language'),
  office('identifier', 'Identifier', 'text', 'core:identifier'),
  office('version', 'Version', 'text', 'core:version'),
  office('created', 'Content created', 'datetime', 'core:created'),
  office('modified', 'Date last saved', 'datetime', 'core:modified'),
  office('company', 'Company', 'text', 'app:Company'),
  office('manager', 'Manager', 'text', 'app:Manager'),
  office('hyperlinkbase', 'Hyperlink base', 'text', 'app:HyperlinkBase'),
  office('template', 'Template', 'text', 'app:Template'),
  office('application', 'Application name', 'text', 'app:Application'),

  // ---- Images -----------------------------------------------------------------
  image('exif_description', 'EXIF image description', 'multiline', 'IFD0:ImageDescription'),
  image('exif_artist', 'EXIF artist', 'text', 'IFD0:Artist'),
  image('exif_copyright', 'EXIF copyright', 'text', 'IFD0:Copyright'),
  image('exif_make', 'Camera make', 'text', 'IFD0:Make'),
  image('exif_model', 'Camera model', 'text', 'IFD0:Model'),
  image('exif_software', 'Software', 'text', 'IFD0:Software'),
  image('exif_datetimeoriginal', 'Date taken', 'datetime', 'ExifIFD:DateTimeOriginal'),
  image('exif_createdate', 'Date digitised', 'datetime', 'ExifIFD:CreateDate'),
  image('exif_usercomment', 'EXIF user comment', 'multiline', 'ExifIFD:UserComment'),
  image('xp_title', 'Windows title', 'text', 'IFD0:XPTitle'),
  image('xp_subject', 'Windows subject', 'text', 'IFD0:XPSubject'),
  image('xp_comment', 'Windows comments', 'multiline', 'IFD0:XPComment'),
  image('xp_keywords', 'Windows tags', 'list', 'IFD0:XPKeywords'),
  image('xp_author', 'Windows authors', 'text', 'IFD0:XPAuthor'),
  image('exif_rating', 'Rating (0–5)', 'rating', 'IFD0:Rating'),
  image('gps', 'GPS location', 'gps', 'EXIF:GPS', { help: 'Decimal degrees: latitude, longitude, altitude (m)' }),
  image('iptc_objectname', 'IPTC object name', 'text', 'IPTC:ObjectName', { help: 'JPEG/TIFF only; max 64 characters' }),
  image('iptc_headline', 'IPTC headline', 'text', 'IPTC:Headline'),
  image('iptc_caption', 'IPTC caption', 'multiline', 'IPTC:Caption-Abstract'),
  image('iptc_keywords', 'IPTC keywords', 'list', 'IPTC:Keywords'),
  image('iptc_byline', 'IPTC by-line (creator)', 'text', 'IPTC:By-line'),
  image('iptc_bylinetitle', 'IPTC by-line title', 'text', 'IPTC:By-lineTitle'),
  image('iptc_credit', 'IPTC credit', 'text', 'IPTC:Credit'),
  image('iptc_source', 'IPTC source', 'text', 'IPTC:Source'),
  image('iptc_copyright', 'IPTC copyright notice', 'text', 'IPTC:CopyrightNotice'),
  image('iptc_contact', 'IPTC contact', 'text', 'IPTC:Contact'),
  image('iptc_city', 'IPTC city', 'text', 'IPTC:City'),
  image('iptc_sublocation', 'IPTC sub-location', 'text', 'IPTC:Sub-location'),
  image('iptc_state', 'IPTC province / state', 'text', 'IPTC:Province-State'),
  image('iptc_country', 'IPTC country', 'text', 'IPTC:Country-PrimaryLocationName'),
  image('iptc_countrycode', 'IPTC country code', 'text', 'IPTC:Country-PrimaryLocationCode', { help: '3 letters, e.g. GBR' }),
  image('iptc_category', 'IPTC category', 'text', 'IPTC:Category', { help: 'Max 3 characters' }),
  image('iptc_supplementalcategories', 'IPTC supplemental categories', 'list', 'IPTC:SupplementalCategories'),
  image('iptc_instructions', 'IPTC special instructions', 'multiline', 'IPTC:SpecialInstructions'),
  image('iptc_writer', 'IPTC writer / editor', 'text', 'IPTC:Writer-Editor'),
  image('iptc_transmissionref', 'IPTC job ID', 'text', 'IPTC:OriginalTransmissionReference'),
  image('iptc_datecreated', 'IPTC date created', 'date', 'IPTC:DateCreated'),
  image('xmp_title', 'XMP title', 'text', 'XMP-dc:Title'),
  image('xmp_description', 'XMP description', 'multiline', 'XMP-dc:Description'),
  image('xmp_creator', 'XMP creators', 'list', 'XMP-dc:Creator'),
  image('xmp_subject', 'XMP keywords', 'list', 'XMP-dc:Subject'),
  image('xmp_rights', 'XMP rights', 'text', 'XMP-dc:Rights'),
  image('xmp_headline', 'XMP headline', 'text', 'XMP-photoshop:Headline'),
  image('xmp_credit', 'XMP credit', 'text', 'XMP-photoshop:Credit'),
  image('xmp_source', 'XMP source', 'text', 'XMP-photoshop:Source'),
  image('xmp_city', 'XMP city', 'text', 'XMP-photoshop:City'),
  image('xmp_state', 'XMP state', 'text', 'XMP-photoshop:State'),
  image('xmp_country', 'XMP country', 'text', 'XMP-photoshop:Country'),
  image('xmp_instructions', 'XMP instructions', 'multiline', 'XMP-photoshop:Instructions'),
  image('xmp_authorsposition', "XMP author's position", 'text', 'XMP-photoshop:AuthorsPosition'),
  image('xmp_captionwriter', 'XMP caption writer', 'text', 'XMP-photoshop:CaptionWriter'),
  image('xmp_transmissionref', 'XMP job ID', 'text', 'XMP-photoshop:TransmissionReference'),
  image('alt_text', 'Alt text (accessibility)', 'multiline', 'XMP-iptcCore:AltTextAccessibility'),
  image('ext_description', 'Extended description (accessibility)', 'multiline', 'XMP-iptcCore:ExtDescrAccessibility'),
  image('xmp_location', 'XMP sub-location', 'text', 'XMP-iptcCore:Location'),
  image('xmp_countrycode', 'XMP country code', 'text', 'XMP-iptcCore:CountryCode'),
  image('rights_marked', 'Copyrighted (rights marked)', 'bool', 'XMP-xmpRights:Marked'),
  image('rights_webstatement', 'Rights web statement (URL)', 'text', 'XMP-xmpRights:WebStatement'),
  image('rights_usageterms', 'Usage terms', 'multiline', 'XMP-xmpRights:UsageTerms'),

  // ---- MP3 (ID3v2.3) ---------------------------------------------------------
  mp3('title', 'Title', 'text', 'title'),
  mp3('artist', 'Contributing artists', 'text', 'artist'),
  mp3('album', 'Album', 'text', 'album'),
  mp3('albumartist', 'Album artist', 'text', 'performerInfo'),
  mp3('composer', 'Composer', 'text', 'composer'),
  mp3('conductor', 'Conductor', 'text', 'conductor'),
  mp3('genre', 'Genre', 'text', 'genre'),
  mp3('year', 'Year', 'text', 'year', { help: '4 digits' }),
  mp3('date', 'Date (DDMM)', 'text', 'date'),
  mp3('track', 'Track number', 'text', 'trackNumber', { help: 'e.g. 3 or 3/12' }),
  mp3('disc', 'Disc number', 'text', 'partOfSet', { help: 'e.g. 1 or 1/2' }),
  mp3('bpm', 'BPM', 'number', 'bpm'),
  mp3('key', 'Initial key', 'text', 'initialKey'),
  mp3('language', 'Language', 'text', 'language', { help: '3-letter code, e.g. eng' }),
  mp3('publisher', 'Publisher', 'text', 'publisher'),
  mp3('copyright', 'Copyright', 'text', 'copyright'),
  mp3('encodedby', 'Encoded by', 'text', 'encodedBy'),
  mp3('isrc', 'ISRC', 'text', 'ISRC'),
  mp3('comment', 'Comment', 'multiline', 'comment'),
  mp3('lyrics', 'Lyrics', 'multiline', 'unsynchronisedLyrics'),
  mp3('originalartist', 'Original artist', 'text', 'originalArtist'),
  mp3('subtitle', 'Subtitle', 'text', 'subtitle'),
  mp3('grouping', 'Grouping', 'text', 'contentGroup'),
  mp3('artisturl', 'Artist URL', 'text', 'artistUrl'),
  mp3('rating', 'Rating (0–5)', 'rating', 'rating'),
  mp3('cover', 'Cover art', 'image', 'image'),

  // ---- MP4 / M4A / MOV ---------------------------------------------------------
  media('title', 'Title', 'text', 'ItemList:Title'),
  media('artist', 'Artist', 'text', 'ItemList:Artist'),
  media('album', 'Album', 'text', 'ItemList:Album'),
  media('albumartist', 'Album artist', 'text', 'ItemList:AlbumArtist'),
  media('composer', 'Composer', 'text', 'ItemList:Composer'),
  media('genre', 'Genre', 'text', 'ItemList:Genre'),
  media('year', 'Year', 'text', 'ItemList:ContentCreateDate', { help: '4 digits' }),
  media('track', 'Track number', 'text', 'ItemList:TrackNumber', { help: 'e.g. 3 of 12' }),
  media('disc', 'Disc number', 'text', 'ItemList:DiskNumber', { help: 'e.g. 1 of 2' }),
  media('comment', 'Comment', 'multiline', 'ItemList:Comment'),
  media('description', 'Description', 'multiline', 'ItemList:Description'),
  media('longdescription', 'Long description', 'multiline', 'ItemList:LongDescription'),
  media('copyright', 'Copyright', 'text', 'ItemList:Copyright'),
  media('encoder', 'Encoded by', 'text', 'ItemList:EncodedBy'),
  media('grouping', 'Grouping', 'text', 'ItemList:Grouping'),
  media('keywords', 'Keywords', 'list', 'ItemList:Keyword'),
  media('cover', 'Cover art', 'image', 'ItemList:CoverArt@file'),
  media('xmp_title', 'XMP title', 'text', 'XMP-dc:Title'),
  media('xmp_description', 'XMP description', 'multiline', 'XMP-dc:Description'),
  media('xmp_creator', 'XMP creators', 'list', 'XMP-dc:Creator'),
  media('xmp_rights', 'XMP rights', 'text', 'XMP-dc:Rights'),
  media('xmp_subject', 'XMP keywords', 'list', 'XMP-dc:Subject'),
];

function tagsFor(fieldId, family) {
  const f = FIELDS.find((x) => x.id === fieldId);
  return (f && f.targets[family]) || [];
}

function fieldsForTab(tab) {
  return FIELDS.filter((f) => f.tab === tab);
}

// A tag can be reached from a Common field and a format-tab field; the
// format-tab field's type is the more precise one (datetime over date), and
// it reads a plain date correctly too, so it wins.
function typeOfTag(tag, family) {
  const hits = FIELDS.filter((x) => (x.targets[family] || []).includes(tag));
  const f = hits.find((x) => x.tab !== 'common') || hits[0];
  return f ? f.type : 'text';
}

module.exports = { FIELDS, TABS, FAMILY_TABS, tagsFor, fieldsForTab, typeOfTag };
