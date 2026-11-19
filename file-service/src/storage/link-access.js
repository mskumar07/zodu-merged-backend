// Who may open a signed file link (GET /files/v/:id, GET /legacy/*).
//
// FILE_LINKS_REQUIRE_AUTH=false (rollout default): the signature alone is the
// proof, as an <img src> can't send an Authorization header.
//
// FILE_LINKS_REQUIRE_AUTH=true: also a valid Bearer access token, from the same
// user the link was signed for (&u=). A link copied to anyone else, or one
// signed without a user, is a 404 like an unknown file. The clients then load
// these images with the token (fetch → blob URL) instead of a plain <img src>.

const { NotFoundError } = require('../utils/error/errors');

// checked: links.checkStable/checkLegacy result ({ validFor, userId } or null).
// Resolves to { validFor, requireAuth }; throws 401 (no/invalid token) or 404.
function createLinkAccess({ requireAuth = false, allowUnsigned = false, getRequestContext }) {
  return async function linkAccess(req, checked) {
    if (!requireAuth) {
      if (!checked && !allowUnsigned) throw NotFoundError();
      return { validFor: checked ? checked.validFor : 0, requireAuth };
    }
    const ctx = await getRequestContext(req);
    if (!checked || !checked.userId || checked.userId !== String(ctx.userId)) throw NotFoundError();
    return { validFor: checked.validFor, requireAuth };
  };
}

// Cache headers for a link response.
function linkCacheHeaders(res, { validFor, requireAuth }) {
  if (requireAuth) res.setHeader('Vary', 'Authorization');
  res.setHeader('Cache-Control', validFor ? `private, max-age=${validFor}` : 'public, max-age=31536000, immutable');
}

module.exports = { createLinkAccess, linkCacheHeaders };
