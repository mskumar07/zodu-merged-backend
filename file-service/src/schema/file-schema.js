const Joi = require('joi');
const { MODULES } = require('../storage/modules');

const moduleName = Joi.string().valid(...Object.keys(MODULES)).required()
  .messages({ 'any.only': 'Unknown module "{#value}"' });
// What users may name in /files/:module/...: internal-only modules (the upload
// staging area) are reachable only through /internal.
const publicModuleName = Joi.string()
  .valid(...Object.keys(MODULES).filter((m) => !MODULES[m].internalOnly)).required()
  .messages({ 'any.only': 'Unknown module "{#value}"' });
const safeId = Joi.string().pattern(/^[A-Za-z0-9_-]{1,64}$/)
  .messages({ 'string.pattern.base': '{#label} may only contain letters, numbers, "-" and "_"' });
const category = Joi.string().max(40);
const fileIds = Joi.array().items(Joi.string().max(64)).min(1).max(100).required();

exports.entityParams = Joi.object({
  module: publicModuleName,
  entityId: safeId.required(),
});

exports.uploadQuery = Joi.object({
  category,
});

exports.downloadQuery = Joi.object({
  download: Joi.string().valid('0', '1', 'true', 'false'),
});

exports.batchUrlsBody = Joi.object({
  file_ids: fileIds,
});

exports.signLinksBody = Joi.object({
  urls: Joi.array().items(Joi.string().max(2048)).min(1).max(100).required(),
});

// Internal routes: the module and record come from the query, the user context from headers.
exports.internalTarget = Joi.object({
  module: moduleName,
  // ignored for the staging module, which files by tenant
  entity_id: Joi.when('module', { is: 'uploads', then: safeId.optional(), otherwise: safeId.required() }),
  category,
  file_name: Joi.string().max(255),
});

exports.claimBody = Joi.object({
  file_ids: fileIds,
  module: publicModuleName,
  entity_id: safeId.required(),
  category,
});

exports.internalDeleteBody = Joi.alternatives().try(
  Joi.object({ file_ids: fileIds }),
  Joi.object({ module: moduleName, entity_id: safeId.required() }),
);
