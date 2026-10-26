/** Compare the platform preset with immutable source modules in any consumer checkout. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import * as current from '../dist/access/index.js';

const [root, revision, rolesPath, permissionsPath, frontendPath] = process.argv.slice(2);
if (!root || !revision || !rolesPath || !permissionsPath) {
  throw Error('Usage: node check-access-compatibility.mjs <checkout> <revision> <roles-module> <permissions-module> [frontend-module]');
}
const cwd = resolve(root);
const baseline = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`], { cwd, encoding: 'utf8' }).trim();
const load = async path => {
  const source = execFileSync('git', ['show', `${baseline}:${path}`], { cwd, encoding: 'utf8' });
  return import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
};
const roles = await load(rolesPath);
const permissions = await load(permissionsPath);
const frontend = frontendPath ? await load(frontendPath) : undefined;
const candidates = ['user', 'moderator', 'security', 'admin', 'superadmin', 'service_role', 'boss', 'unknown', ''];
let checks = 0;
let refusedUnknownTargets = 0;
const same = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
for (const actor of candidates) {
  same(current.expandRoles(actor), roles.expandRoles(actor));
  same(current.rolePriority(actor), roles.rolePriority(actor));
  for (const target of candidates) {
    for (const method of ['canModerateUserWithRole', 'canSeeUserWithRole']) {
      const actual = current[method]([actor], target);
      const previous = roles[method]([actor], target);
      if (current.rolePriority(target) < 0 && previous === true) {
        // An explicit security correction: unknown targets never receive authority.
        same(actual, false);
        refusedUnknownTargets++;
      } else same(actual, previous);
    }
    same(current.assignableRolesFor([actor], candidates, target), roles.assignableRolesFor([actor], candidates, target));
  }
}
const keys = ['*', 'admin', 'admin.*', 'admin.users', 'admin.users.*', 'admin.users.edit', 'admin.usersextra.edit', 'org.members', 'org.members.invite', 'site.profile.edit', '', '.', '.*', 'admin.', 'admin..*'];
for (const grant of keys) for (const required of keys) {
  const value = current.permissionGrants(grant, required);
  same(value, permissions.permissionGrants(grant, required));
  if (frontend) {
    same(value, frontend.permissionMatches(grant, required));
    same(current.hasPermission([grant], required), frontend.hasPermissionMatch([grant], required));
  }
}
console.log(JSON.stringify({ compatible: true, baseline, checks, refusedUnknownTargets }));
