// Single source of truth for every module that stores files.
// Adding a new module = adding one entry here; no other code changes.
//
//   scope          'branch' → {zoduId}/{branchId}/{module}/...
//                  'tenant' → {zoduId}/_shared/{module}/...
//   allowedTypes   MIME allow-list. The type is detected from the file's bytes
//                  (file-inspector.js), never taken from the browser.
//   maxSizeMb      per-file size limit
//   categories     optional sub-folders inside a record (e.g. employee profile vs documents)
//   datePartition  add yyyy/mm to the path (the staging area, which is purged by age)
//   entityFolder   false: files sit directly in the module folder (menu-items); the
//                  record is still kept in tbl_files.entity_id
//   access         'link'    → URL is /files/v/:fileId, which the services store. It is
//                              served without an Authorization header, but only with the
//                              expiring ?exp=&sig= every response adds (signed-links.js)
//                  'private' → only through a presigned URL or the authorised stream
//   streamOnly     private files that never get a presigned URL: only GET /files/:fileId/content
//   permission     tbl_modules.module_name the caller needs: read to download,
//                  create to upload, delete to delete
//   transform      compression after inspection (transform.js). Every image is
//                  re-encoded visually lossless anyway; this adds resizing,
//                  format conversion and PDF compression
//   keepOnDelete   accounting records: a soft delete never removes the object
//   internalOnly   only other services may upload to it (/internal/upload), never users directly

const MIME = {
  JPEG: 'image/jpeg',
  PNG:  'image/png',
  WEBP: 'image/webp',
  PDF:  'application/pdf',
  DOC:  'application/msword',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  CSV:  'text/csv',
};

// Every type the system can accept at all. SVG, HTML, XML, archives and
// executables are deliberately absent: they can carry scripts.
//   ext      extension used in the stored key
//   names    file-name extensions accepted for this type (must match the content)
//   inline   safe to display in the browser; everything else is served as a download
const FILE_TYPES = {
  [MIME.JPEG]: { ext: 'jpg',  names: ['jpg', 'jpeg'], inline: true },
  [MIME.PNG]:  { ext: 'png',  names: ['png'],         inline: true },
  [MIME.WEBP]: { ext: 'webp', names: ['webp'],        inline: true },
  [MIME.PDF]:  { ext: 'pdf',  names: ['pdf'],         inline: true },
  [MIME.DOC]:  { ext: 'doc',  names: ['doc'],         inline: false },
  [MIME.DOCX]: { ext: 'docx', names: ['docx'],        inline: false },
  [MIME.XLSX]: { ext: 'xlsx', names: ['xlsx'],        inline: false },
  [MIME.CSV]:  { ext: 'csv',  names: ['csv'],         inline: false },
};

const IMAGES = [MIME.JPEG, MIME.PNG, MIME.WEBP];
const PDF    = [MIME.PDF];
const DOCS   = [MIME.PDF, MIME.DOC, MIME.DOCX, MIME.XLSX, MIME.CSV];

// tbl_modules.module_name values (auth-service DB).
const PERM = {
  SETTINGS:  'Settings',
  MENU:      'Menu Items',
  EXPENSE:   'Expense',
  PURCHASE:  'Purchase',
  CUSTOMER:  'Customer Management',
  STAFF:     'Staff / User Management',
  CHECKLIST: 'Checklist / Tasklist',
  SALES:     'Sales History',
  REPORTS:   'Reports',
};

// Menu pictures, shown in the apps: 1800px is sharp on any screen.
const PHOTO = { image: { maxPx: 1800, format: 'webp' } };
// Logos are also printed on invoices and receipts by the apps, and some PDF and
// thermal-printer libraries can't read WebP: same size cap, original format.
const LOGO = { image: { maxPx: 1800 } };
// Bills, IDs, attachments: keep the format people download and forward, and
// only shrink phone photos beyond 3000px, so small print stays readable.
const DOCUMENT = { image: { maxPx: 3000 }, pdf: true };

// Staging area for the services' generic "upload first, save the record later"
// routes (/upload, /upload/multiple). Files wait here under _staging/ until the
// record that uses them is saved and claims them into its own module and key
// (POST /internal/claim). Unclaimed files are purged after STAGING_TTL_HOURS.
// It carries menu pictures, bills and branch images (printed on invoices), so
// files keep their format and document size here; claiming a file into a module
// with a smaller size or another format (menu-items) re-encodes it then.
const STAGING = 'uploads';

// branding / invoice-settings allow 5MB: the old upload routes accepted that
// (logo, watermark), and clients don't change in Phase 2.
const MODULES = {
  [STAGING]:          { scope: 'staging', allowedTypes: [...IMAGES, ...DOCS],          maxSizeMb: 10, datePartition: true, access: 'link', internalOnly: true, transform: DOCUMENT },
  'branding':         { scope: 'tenant', allowedTypes: IMAGES,                        maxSizeMb: 5,  categories: ['logo'], access: 'link', permission: PERM.SETTINGS, transform: LOGO },
  'invoice-settings': { scope: 'branch', allowedTypes: [MIME.PNG, MIME.WEBP, MIME.JPEG], maxSizeMb: 5, categories: ['signature', 'watermark', 'receiver-signature'], access: 'link', permission: PERM.SETTINGS },
  'menu-items':       { scope: 'branch', allowedTypes: IMAGES,                        maxSizeMb: 5,  entityFolder: false, access: 'link', permission: PERM.MENU, transform: PHOTO },
  'expense':          { scope: 'branch', allowedTypes: [...IMAGES, ...DOCS],          maxSizeMb: 10, access: 'private', permission: PERM.EXPENSE, keepOnDelete: true, transform: DOCUMENT },
  'purchase':         { scope: 'branch', allowedTypes: [...IMAGES, ...DOCS],          maxSizeMb: 10, categories: ['order', 'bill'], access: 'private', permission: PERM.PURCHASE, keepOnDelete: true, transform: DOCUMENT },
  'customer-payment': { scope: 'branch', allowedTypes: [...IMAGES, ...PDF],           maxSizeMb: 10, access: 'private', permission: PERM.CUSTOMER, keepOnDelete: true, transform: DOCUMENT },
  // Aadhaar / PAN: never a presigned URL (it could be forwarded); only the authorised stream.
  'employee':         { scope: 'branch', allowedTypes: [...IMAGES, MIME.PDF, MIME.DOC, MIME.DOCX], maxSizeMb: 10, categories: ['profile', 'documents'], access: 'private', streamOnly: true, permission: PERM.STAFF, transform: DOCUMENT },
  'checklist':        { scope: 'branch', allowedTypes: [...IMAGES, ...DOCS],          maxSizeMb: 10, categories: ['attachments', 'items'], access: 'private', permission: PERM.CHECKLIST, transform: DOCUMENT },
  'invoice':          { scope: 'branch', allowedTypes: PDF,                           maxSizeMb: 10, access: 'private', permission: PERM.SALES, keepOnDelete: true },
  'reports':          { scope: 'branch', allowedTypes: [MIME.PDF, MIME.XLSX, MIME.CSV], maxSizeMb: 25, categories: ['gst', 'sales', 'stock', 'purchase', 'expense', 'inventory'], access: 'private', permission: PERM.REPORTS, keepOnDelete: true },
  'documents':        { scope: 'tenant', allowedTypes: [...IMAGES, ...DOCS],          maxSizeMb: 10, access: 'private', permission: PERM.SETTINGS, transform: DOCUMENT },
};

// Most files one upload request may carry.
const MAX_FILES_PER_UPLOAD = 10;

// Largest per-file limit of any module: the hard cap multer and raw bodies start from.
const MAX_MODULE_SIZE_MB = Math.max(...Object.values(MODULES).map((m) => m.maxSizeMb));

// Stored file extension comes from the detected type, never the user's file name.
const EXT_BY_MIME = Object.fromEntries(Object.entries(FILE_TYPES).map(([mime, t]) => [mime, t.ext]));

function getModule(name) {
  const mod = Object.hasOwn(MODULES, name) ? MODULES[name] : undefined;
  if (!mod) throw Object.assign(new Error(`Unknown module "${name}"`), { status: 400 });
  return mod;
}

module.exports = {
  MIME, FILE_TYPES, MODULES, PERM, STAGING, MAX_FILES_PER_UPLOAD, MAX_MODULE_SIZE_MB, EXT_BY_MIME, getModule,
};
