// Prints the permissions-matrix tables (markdown) from each service's
// src/security/rules.js: node scripts/permissions-matrix.js <repo root>
const path = require('path');
const root = path.resolve(process.argv[2] || '.');
const SERVICES = [
  ['auth-service', '/auth'], ['employee-service', '/employee'], ['checklist-service', '/checklist'],
  ['retail-service', '/retail'], ['restaurant-service', '/restaurant'],
];
const fmtPath = (p) => (p instanceof RegExp ? `\`${p.source.replace(/\|/g, '\\|')}\` (regex)` : `\`${p}\``);
const fmtMethod = (m) => (!m ? 'any' : Array.isArray(m) ? m.join(', ') : m);
const who = (r) => {
  if (r.public) return 'public';
  if (r.authenticated) return 'any signed-in user';
  if (r.any) return `one of: ${r.any.map((p) => `\`${p}\``).join(', ')}`;
  const perms = Array.isArray(r.perm) ? r.perm : [r.perm];
  return perms.map((p) => `\`${p}\``).join(' + ');
};
const out = [];
for (const [svc, prefix] of SERVICES) {
  const Module = require('module');
  const req = Module.createRequire(path.join(root, svc, 'package.json'));
  const rules = req(path.join(root, svc, 'src/security/rules.js'));
  out.push(`## ${svc} (gateway \`${prefix}\`)`, '', '| Method | Path | Who |', '|---|---|---|');
  for (const r of rules) out.push(`| ${fmtMethod(r.method)} | ${fmtPath(r.path)} | ${who(r)} |`);
  out.push('');
}
process.stdout.write(out.join('\n'));
