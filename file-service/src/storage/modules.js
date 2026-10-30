// Single source of truth for every module that stores files.
// Adding a new module = adding one entry here; no other code changes.
//
//   scope          'branch' → {zoduId}/{branchId}/{module}/...
//                  'tenant' → {zoduId}/_shared/{module}/...
//   allowedTypes   MIME allow-list. The type is detected from the file's bytes
//                  (file-inspector.js), never taken from the browser.
//   maxSizeMb      per-file size limit
//   categories     optional sub-folders inside a record (e.g. employee profile vs documents)
//   datePartition  add yyyy/mm to the path for high-volume modules
//   access         'link'    → also served by the unauthenticated, cacheable GET /files/v/:fileId
//                  'private' → only through a presigned URL or the authorised stream
//   streamOnly     private files that never get a presigned URL: only GET /files/:fileId/content
//   permission     tbl_modules.module_name the caller needs: read to download,
//                  create to upload, delete to delete
//   transform      optional re-encoding after inspection (transform.js)
//   keepOnDelete   accounting records: a soft delete never removes the object

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

const OPTIMISE_IMAGES = { image: { maxPx: 1800, format: 'webp' } };

const MODULES = {
  'branding':         { scope: 'tenant', allowedTypes: IMAGES,                        maxSizeMb: 2,  categories: ['logo'], access: 'link', permission: PERM.SETTINGS, transform: OPTIMISE_IMAGES },
  'invoice-settings': { scope: 'branch', allowedTypes: [MIME.PNG, MIME.WEBP, MIME.JPEG], maxSizeMb: 1, categories: ['signature', 'watermark', 'receiver-signature'], access: 'link', permission: PERM.SETTINGS },
  'menu-items':       { scope: 'branch', allowedTypes: IMAGES,                        maxSizeMb: 5,  access: 'link', permission: PERM.MENU, transform: OPTIMISE_IMAGES },
  'expense':          { scope: 'branch', allowedTypes: [...IMAGES, ...DOCS],          maxSizeMb: 10, datePartition: true, access: 'private', permission: PERM.EXPENSE, keepOnDelete: true },
  'purchase':         { scope: 'branch', allowedTypes: [...IMAGES, ...DOCS],          maxSizeMb: 10, categories: ['order', 'bill'], datePartition: true, access: 'private', permission: PERM.PURCHASE, keepOnDelete: true },
  'customer-payment': { scope: 'branch', allowedTypes: [...IMAGES, ...PDF],           maxSizeMb: 10, datePartition: true, access: 'private', permission: PERM.CUSTOMER, keepOnDelete: true },
  // Aadhaar / PAN: never a presigned URL (it could be forwarded); only the authorised stream.
  'employee':         { scope: 'branch', allowedTypes: [...IMAGES, MIME.PDF, MIME.DOC, MIME.DOCX], maxSizeMb: 10, categories: ['profile', 'documents'], access: 'private', streamOnly: true, permission: PERM.STAFF },
  'checklist':        { scope: 'branch', allowedTypes: [...IMAGES, ...DOCS],          maxSizeMb: 10, categories: ['attachments', 'items'], datePartition: true, access: 'private', permission: PERM.CHECKLIST },
  'invoice':          { scope: 'branch', allowedTypes: PDF,                           maxSizeMb: 10, datePartition: true, access: 'private', permission: PERM.SALES, keepOnDelete: true },
  'reports':          { scope: 'branch', allowedTypes: [MIME.PDF, MIME.XLSX, MIME.CSV], maxSizeMb: 25, categories: ['gst', 'sales', 'stock', 'purchase', 'expense', 'inventory'], datePartition: true, access: 'private', permission: PERM.REPORTS, keepOnDelete: true },
  'documents':        { scope: 'tenant', allowedTypes: [...IMAGES, ...DOCS],          maxSizeMb: 10, access: 'private', permission: PERM.SETTINGS },
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
  MIME, FILE_TYPES, MODULES, PERM, MAX_FILES_PER_UPLOAD, MAX_MODULE_SIZE_MB, EXT_BY_MIME, getModule,
};
