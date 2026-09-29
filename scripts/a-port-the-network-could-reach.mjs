#!/usr/bin/env node
/**
 * A port the network could reach.
 *
 * A compose mapping written `"15432:5432"` publishes on 0.0.0.0. On this
 * machine that is not «local»: docker's forwarding sits in front of the host
 * firewall, so the LAN reaches the port whatever the firewall says. Measured
 * in daos on 2026-09-16 — its test Postgres answered a psql login from another
 * address on the network, with the credentials written in its compose file.
 * On 2026-09-29 this repository still published its own test Postgres
 * (test/test) and Redis that way in `docker-compose.test.yml`, and seven
 * databases in `packages/titan/test/docker/docker-compose.test.yml`; a peer's
 * isolated copy of the first one listened on `0.0.0.0:25432` while it lived.
 *
 * Every tracked compose file is read, every published port is found — the
 * short form (`"[ip:]host:container[/proto]"`, a bare `"container"` too, which
 * docker publishes on an ephemeral port on every interface) and the long form
 * (`published:` with or without `host_ip:`) — and each must be bound to the
 * loopback (`127.0.0.1` or `::1`). A port that must be public says so on its
 * own line: `# public: <why>` — a P2P port a node needs inbound peers on, say.
 * Those are listed, not refused.
 *
 * The containers the test manager starts are held by a live court beside it
 * (`packages/testing/src/docker/a-port-the-network-could-reach.spec.ts`);
 * source that builds `docker run -p` is not read here.
 *
 *   node scripts/a-port-the-network-could-reach.mjs            every tracked compose file
 *   node scripts/a-port-the-network-could-reach.mjs <file>…    these (paths from the root)
 *
 * Exit 0 when every published port is on the loopback or says why not;
 * 1 with each one that is not.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = /(^|\/)(docker-)?compose[^/]*\.ya?ml$/;
const LOOPBACK = /^(127\.0\.0\.1|\[?::1\]?)$/;
const PUBLIC = /#\s*public:\s*\S/;

// The repository's tracked compose files; or the files named, relative to the
// root — how this scanner's own reading of each form is checked.
const named = process.argv.slice(2);
const files =
  named.length > 0
    ? named
    : execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
        .split('\n')
        .filter((f) => COMPOSE.test(f));

/**
 * The host address a short-form mapping binds, or null for every interface.
 * `${VAR:-15432}:5432` and `127.0.0.1:${VAR:-15432}:5432` both occur, so a
 * `${…}` is taken whole before the string is split on colons.
 */
function hostOfShort(mapping) {
  const parts = [];
  let rest = mapping.replace(/\/(tcp|udp|sctp)$/, '');
  while (rest.length > 0) {
    if (rest.startsWith('${')) {
      const end = rest.indexOf('}');
      parts.push(rest.slice(0, end + 1));
      rest = rest.slice(end + 1).replace(/^:/, '');
    } else if (rest.startsWith('[')) {
      const end = rest.indexOf(']');
      parts.push(rest.slice(0, end + 1));
      rest = rest.slice(end + 1).replace(/^:/, '');
    } else {
      const i = rest.indexOf(':');
      parts.push(i === -1 ? rest : rest.slice(0, i));
      rest = i === -1 ? '' : rest.slice(i + 1);
    }
  }
  // container | host:container | ip:host:container
  return parts.length === 3 ? parts[0] : null;
}

const refused = [];
const declared = [];
let count = 0;

for (const file of files) {
  const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
  let portsIndent = null;
  let longEntry = null; // { line, hostIp, published, text }
  const closeLong = () => {
    if (longEntry && longEntry.published) {
      count++;
      if (longEntry.public) declared.push(`${file}:${longEntry.line}  ${longEntry.text}`);
      else if (!longEntry.hostIp || !LOOPBACK.test(longEntry.hostIp)) {
        refused.push(`${file}:${longEntry.line}  published ${longEntry.published} on ${longEntry.hostIp ?? 'every interface'}`);
      }
    }
    longEntry = null;
  };
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '');
    const indent = line.length - line.trimStart().length;
    const code = line.replace(/\s+#.*$/, '');
    if (/^\s*ports:\s*$/.test(code)) {
      closeLong();
      portsIndent = indent;
      return;
    }
    if (portsIndent === null) return;
    if (code.trim() === '' || /^\s*#/.test(line)) return;
    if (indent <= portsIndent && !code.trimStart().startsWith('-')) {
      closeLong();
      portsIndent = null;
      return;
    }
    const item = /^\s*-\s*(.*)$/.exec(code);
    if (item) {
      closeLong();
      const value = item[1].trim();
      const short = /^["']?([^"'\s]+)["']?$/.exec(value);
      if (short && !/^\w+:\s/.test(value)) {
        count++;
        const host = hostOfShort(short[1]);
        if (PUBLIC.test(line)) declared.push(`${file}:${i + 1}  ${short[1]}`);
        else if (!host || !LOOPBACK.test(host)) refused.push(`${file}:${i + 1}  "${short[1]}" on ${host ?? 'every interface'}`);
        return;
      }
      // Long form: `- target: 80` begins an entry; its keys follow.
      longEntry = { line: i + 1, hostIp: null, published: null, public: PUBLIC.test(line), text: value };
      const kv = /^(\w+):\s*["']?([^"'\s]*)["']?/.exec(value);
      if (kv && kv[1] === 'host_ip') longEntry.hostIp = kv[2];
      if (kv && kv[1] === 'published') longEntry.published = kv[2];
      return;
    }
    if (longEntry) {
      const kv = /^\s*(\w+):\s*["']?([^"'\s]*)["']?/.exec(code);
      if (kv && kv[1] === 'host_ip') longEntry.hostIp = kv[2];
      if (kv && kv[1] === 'published') longEntry.published = kv[2];
      if (PUBLIC.test(line)) longEntry.public = true;
    }
  });
  closeLong();
}

if (declared.length > 0) {
  console.log(`${declared.length} port(s) public on purpose (# public: …):`);
  for (const d of declared) console.log(`  ${d}`);
}
if (refused.length > 0) {
  console.error(`${refused.length} of ${count} published port(s) in ${files.length} compose file(s) reach the network:`);
  for (const r of refused) console.error(`  ${r}`);
  console.error('Bind each to the loopback ("127.0.0.1:host:container"), or say on its line why it must not be: # public: <why>');
  process.exit(1);
}
console.log(`${count} published port(s) in ${files.length} compose file(s), all on the loopback or public on purpose`);
