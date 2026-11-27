const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs'), crypto = require('node:crypto');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const q = JSON.parse(fs.readFileSync(0, 'utf8'));
const db = new DatabaseSync('/state/data.sqlite');
db.exec('CREATE TABLE IF NOT EXISTS history(name TEXT PRIMARY KEY, sha256 TEXT); CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, value TEXT)');
if (fs.readFileSync('/input/statics/index.html','utf8') !== ROLE || q.releaseId !== ROLE) process.exit(2);
const prior = ['main/218.sql'], names = [...prior, ...q.addedMigrations];
const phase = q.phase;
const through = phase === 'baseline' ? 1 : phase === 'candidate-partial' ? 2 : 3;
if (phase === 'baseline' || phase === 'candidate-partial' || phase === 'candidate-write' || phase === 'recovery-complete')
  for (const name of names.slice(0, through))
    db.prepare('INSERT OR IGNORE INTO history VALUES (?,?)').run(name, sha('SQL '+name));
const insert = phase === 'baseline' ? 'before' : phase.startsWith('candidate-') ? 'candidate' :
  ['recovery-write','recovery-replay'].includes(phase) ? 'after' : null;
if (insert) db.prepare('INSERT OR IGNORE INTO records VALUES (?,?)').run(insert, q.challenge+insert);
const history = db.prepare('SELECT name,sha256 FROM history ORDER BY rowid').all();
const rows = Object.fromEntries(db.prepare('SELECT id,value FROM records').all().map(r=>[r.id,sha(JSON.stringify(r))]));
const checked = JSON.stringify(history) === JSON.stringify(names.slice(0,through).map(name=>({name,sha256:sha('SQL '+name)})));
console.log(JSON.stringify({phase, challenge:q.challenge, history, records:{awards:rows},
  verification:{exitCode:checked?0:2,checkedMigrations:history.length,historySha256:sha(JSON.stringify(history))}}));
db.close();
