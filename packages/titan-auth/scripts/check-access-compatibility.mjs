import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import * as current from '../dist/access/index.js';
const root = process.argv[2];
if (!root) throw Error('Pass a SAMPLE checkout to compare its existing contracts');
const baseline=process.argv[3] ?? 'HEAD';
const load = p => {
  const source=execFileSync('git',['show',baseline+':'+p],{cwd:resolve(root),encoding:'utf8'});
  const js=stripTypeScriptTypes(source);
  return import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
};
const roles = await load('packages/auth-utils/src/role-hierarchy.ts');
const permissions = await load('apps/main/src/shared/permission-engine.ts');
const frontend = await load('apps/portal/src/auth/permission-match.ts');
const candidates = ['user','moderator','security','admin','superadmin','service_role','boss','unknown',''];
let checks=0;
const same=(a,b)=>{assert.deepEqual(a,b);checks++};
for (const actor of candidates) {
  same(current.expandRoles(actor),roles.expandRoles(actor));
  same(current.rolePriority(actor),roles.rolePriority(actor));
  for (const target of candidates) {
    same(current.canModerateUserWithRole([actor],target),roles.canModerateUserWithRole([actor],target));
    same(current.canSeeUserWithRole([actor],target),roles.canSeeUserWithRole([actor],target));
    same(current.assignableRolesFor([actor],candidates,target),roles.assignableRolesFor([actor],candidates,target));
  }
}
const keys=['*','admin','admin.*','admin.users','admin.users.*','admin.users.edit','admin.usersextra.edit','org.members','org.members.invite','site.profile.edit','','.','.*','admin.','admin..*'];
for (const grant of keys) for(const required of keys) {
  const value=current.permissionGrants(grant,required);
  same(value,permissions.permissionGrants(grant,required));
  same(value,frontend.permissionMatches(grant,required));
  same(current.hasPermission([grant],required),frontend.hasPermissionMatch([grant],required));
}
console.log(JSON.stringify({compatible:true,baseline,checks}));
