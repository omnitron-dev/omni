import { isProjectStarterNeeds, type ProjectStarterNeeds, type ProjectStarterManifest } from '../shared/dto/project.js';
import type { PipelineDef } from '../shared/dto/pipelines.js';

export const starterConfig = 'omnitron.config.ts';
export function starterConfiguration(app: string | null) {
  const config = app ? {
    apps: [{ name: app, script: './omnitron-worker.js' }],
    stacks: { dev: { type: 'local', apps: [app], infrastructureOwnership: 'external', watch: false } },
  } : { apps: [], stacks: {} };
  return { path: starterConfig, content: 'export default ' + JSON.stringify(config, null, 2) + ';\n' };
}

const databaseDrivers = {
  sqlite: { dependency: 'better-sqlite3', version: '13.0.3', dialect: 'SqliteDialect',
    imports: "import Database from 'better-sqlite3';\nimport { fileURLToPath } from 'node:url';",
    options: "{ database: new Database(fileURLToPath(new URL('./starter.sqlite', import.meta.url))) }" },
  postgresql: { dependency: 'pg', version: '8.23.1', dialect: 'PostgresDialect',
    imports: "import pg from 'pg';", options: '{ pool: new pg.Pool({ connectionString: databaseUrl }) }' },
  mysql: { dependency: 'mysql2', version: '3.24.6', dialect: 'MysqlDialect',
    imports: "import mysql from 'mysql2';", options: '{ pool: mysql.createPool(databaseUrl) }' },
} as const;

function databaseModule(engine: keyof typeof databaseDrivers, connectionVariable: string): string {
  const driver = databaseDrivers[engine];
  const connection = engine === 'sqlite' ? '' : `
  const databaseUrl = process.env[${JSON.stringify(connectionVariable)}];
  if (!databaseUrl || !URL.canParse(databaseUrl) || !${JSON.stringify(engine === 'mysql' ? ['mysql:'] : ['postgres:', 'postgresql:'])}.includes(new URL(databaseUrl).protocol))
    throw Error('Set ${connectionVariable} for the selected ${engine} database');`;
  return `import { randomUUID } from 'node:crypto';
import { Kysely, ${driver.dialect} } from 'kysely';
import { createExecutor } from '@kysera/executor';
${driver.imports}

export async function recordEvent(source) {${connection}
  const db = new Kysely({ dialect: new ${driver.dialect}(${driver.options}) });
  try {
    const executor = await createExecutor(db);
    await db.schema.createTable('starter_events').ifNotExists()
      .addColumn('id', 'varchar(36)', column => column.primaryKey())
      .addColumn('source', 'varchar(32)', column => column.notNull()).execute();
    const id = randomUUID();
    await executor.insertInto('starter_events').values({ id, source }).execute();
    return await executor.selectFrom('starter_events').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  } finally { await db.destroy(); }
}
`;
}

/** Keep the program portable and resolve its directory when the operator generates a definition. */
function pipelineProgram(name: string, entry: 'starter-task.js' | 'starter-data.js') {
  const definition: PipelineDef = {
    name: name + '-task',
    steps: [{
      name: 'run-task',
      kind: 'xec',
      retries: 0,
      timeout: 60_000,
      run: `const result = await $.exec(process.execPath, { args: ['${entry}'], shell: false });\nprocess.stdout.write(result.stdout);`,
    }],
  };
  return `import { realpathSync } from 'node:fs';

const definition = ${JSON.stringify(definition, null, 2)};
definition.steps[0].cwd = realpathSync(new URL('.', import.meta.url));
console.log(JSON.stringify(definition, null, 2));
`;
}

function workerProgram(needs: ProjectStarterNeeds): string {
  const titan = needs.service === 'titan';
  return [
    ...(titan ? ["import { Application } from '@omnitron-dev/titan/application';"] : []),
    ...(needs.persistence !== 'none' ? ["import { recordEvent } from './starter-database.js';"] : []),
    ...(titan ? ["const app = await Application.create({ name: 'worker', disableCoreModules: true, disableGracefulShutdown: true });", 'await app.start();'] : []),
    ...(needs.persistence !== 'none' ? ["console.log(JSON.stringify(await recordEvent('worker')));"] : []),
    "const report = () => console.log(JSON.stringify({ app: 'worker', uptimeSeconds: Math.floor(process.uptime()) }));",
    'report();', 'const timer = setInterval(report, 60_000);',
    "process.send?.({ type: 'ready' });", '',
    `async function stop() {`, '  clearInterval(timer);',
    ...(titan ? ['  await app.stop();'] : []), '  if (process.connected) process.disconnect();', '}',
    "process.once('SIGTERM', stop);", "process.once('SIGINT', stop);", '',
  ].join('\n');
}

export function planStarter(name: string, input: ProjectStarterNeeds) {
  if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{0,62}$/.test(name))
    throw Error('Use a project name of 1–63 lowercase letters, digits or hyphens, starting with a letter');
  if (!isProjectStarterNeeds(input)) throw Error('Select automation, a supported database, or a service to create a runnable project');
  const needs = { automation: input.automation, persistence: input.persistence, service: input.service };
  const manifest: ProjectStarterManifest = { version: 1, name, needs, dependencies: {}, commands: {}, app: null, stack: null };
  const files: Array<{ path: string; content: string }> = [];
  const effects = ['Create a new directory and register the project.'];
  const finiteTask = needs.automation || needs.persistence !== 'none';
  const connectionVariable = 'PROJECT_' + name.toUpperCase().replaceAll('-', '_') + '_DATABASE_URL';
  if (needs.automation) {
    manifest.dependencies['@xec-sh/core'] = '0.13.2';
    manifest.commands['automation'] = 'node starter-task.js';
    const programs = ['starter-task.js', 'starter-pipeline.js', ...(needs.persistence === 'none' ? [] : ['starter-database.js', 'starter-data.js']),
      ...(needs.service === 'none' ? [] : ['omnitron-worker.js'])];
    files.push({ path: 'starter-task.js', content: `import { $ } from '@xec-sh/core';

try {
  const checked = ${JSON.stringify(programs)};
  for (const file of checked) {
    await $.exec(process.execPath, { args: ['--check', file], shell: false });
  }
${needs.persistence === 'none' ? '  console.log(JSON.stringify({ checked, node: process.version }));' :
  "  const result = await $.exec(process.execPath, { args: ['starter-data.js'], shell: false });\n  console.log(JSON.stringify({ checked, node: process.version, event: JSON.parse(result.stdout) }));"}
} finally { await $.dispose(); }
` });
    effects.push(needs.persistence === 'none' ? 'The Xec task checks every program with the local Node runtime.'
      : 'The Xec task checks each program and runs the database command.');
  }
  if (needs.persistence !== 'none') {
    const driver = databaseDrivers[needs.persistence];
    Object.assign(manifest.dependencies, { '@kysera/executor': '0.10.2', kysely: '0.29.8', [driver.dependency]: driver.version });
    manifest.commands['data'] = 'node starter-data.js';
    files.push({ path: 'starter-database.js', content: databaseModule(needs.persistence, connectionVariable) },
      { path: 'starter-data.js', content: "import { recordEvent } from './starter-database.js';\nconsole.log(JSON.stringify(await recordEvent('command')));\n" });
    effects.push(needs.persistence === 'sqlite' ? 'The data command opens starter.sqlite in this project.'
      : `Set ${connectionVariable} to your project's ${needs.persistence} database before running its commands.`);
    effects.push('A data command or service start creates starter_events if needed, writes one event and reads it back.');
  }
  if (needs.service !== 'none') {
    if (needs.service === 'titan') manifest.dependencies['@omnitron-dev/titan'] = '0.4.14';
    manifest.app = 'worker';
    manifest.stack = 'dev';
    manifest.commands['start'] = 'node omnitron-worker.js';
    files.push({ path: 'omnitron-worker.js', content: workerProgram(needs) });
    effects.push(`Start the ${needs.service === 'titan' ? 'Titan' : 'Node'} worker directly or from the dev stack. It reports uptime and IPC readiness.`);
  }
  if (finiteTask) {
    manifest.commands['pipeline'] = 'node starter-pipeline.js';
    files.push({ path: 'starter-pipeline.js', content: pipelineProgram(name, needs.automation ? 'starter-task.js' : 'starter-data.js') });
    effects.push('The pipeline command prints a manual, one-step definition for review in the controller workspace.');
  }
  const install = Object.keys(manifest.dependencies).length > 0;
  if (install) effects.push('Run npm install in the project directory before the first command.');
  const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
  files.push({ path: 'package.json', content: json({ name, private: true, type: 'module', scripts: manifest.commands, dependencies: manifest.dependencies }) },
    { path: 'omnitron.starter.json', content: json(manifest) },
    { path: 'README.md', content: ['# ' + name, '', ...effects.slice(1).map(effect => effect + '\n'), '## Run', '',
      '```sh', ...(install ? ['npm install'] : []), ...Object.keys(manifest.commands).filter(command => command !== 'pipeline').map(command => 'npm run ' + command), '```', '',
      ...(finiteTask ? ['## Run the task through Omnitron', '',
        'On the controller host, review the project source and its installed dependencies. Generate the definition from this directory.', '',
        '```sh', 'npm run --silent pipeline > starter.pipeline.json', 'omnitron pipeline check starter.pipeline.json --json',
        'omnitron pipeline save starter.pipeline.json --json', '```', '',
        'Use `data.id` from save as PIPELINE_ID. In the prepared response, `data.id` is RUN_ID and `data.review.digest` is DIGEST. Check the command and working directory before starting it.', '',
        '```sh', 'omnitron pipeline run PIPELINE_ID --prepare --json',
        'omnitron pipeline start RUN_ID --expected-digest DIGEST', 'omnitron pipeline status RUN_ID --output', '```', '',
        'The system workspace lists this task under Pipelines, including its status and output. The review pins the graph and the local directory. Source and dependencies are read from the working tree at run time.',
        ...(needs.persistence !== 'none' && needs.persistence !== 'sqlite' ? ['',
          `Supply ${connectionVariable} through an operator-controlled runtime environment. Keep its value out of the pipeline definition.`] : []), ''] : [])].join('\n') },
    starterConfiguration(manifest.app));
  const names = new Set(files.map(file => file.path));
  if (names.size !== files.length || files.some(file => !/^[a-z0-9][a-z0-9.-]*$/i.test(file.path)) ||
      Object.values(manifest.commands).some(command => !command.startsWith('node ') || !names.has(command.slice('node '.length))))
    throw Error('The starter contains a duplicate, invalid filename or missing command entry');
  return { manifest, files, effects };
}
