import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

it('builds a consumer layout with state and context through the native CLI and its own React peers', () => {
  const installedConsumer = process.env['LUMEN_CONSUMER_ROOT'] && realpathSync(process.env['LUMEN_CONSUMER_ROOT']);
  const installedRequire = installedConsumer ? createRequire(join(installedConsumer, 'package.json')) : undefined;
  const lumenDirectory = installedRequire
    ? dirname(dirname(realpathSync(installedRequire.resolve('@omnitron-dev/lumen'))))
    : fileURLToPath(new URL('..', import.meta.url));
  const lumenRequire = createRequire(join(lumenDirectory, 'package.json'));
  const root = realpathSync(mkdtempSync(join(installedConsumer || tmpdir(), 'lumen-ssr-consumer-')));
  try {
    if (installedConsumer) {
      expect(lumenDirectory.startsWith(join(installedConsumer, 'node_modules') + sep)).toBe(true);
    } else {
      // Reproduce the linked SDK topology with real installed peers. The native
      // CLI retains its SDK dependencies; the consumer has a distinct React.
      const modules = join(root, 'node_modules');
      mkdirSync(join(modules, '@omnitron-dev'), { recursive: true });
      symlinkSync(lumenDirectory, join(modules, '@omnitron-dev/lumen'), 'dir');
      for (const name of ['react', 'react-dom', 'scheduler']) {
        const source = dirname(realpathSync(lumenRequire.resolve(`${name}/package.json`)));
        cpSync(source, join(modules, name), { recursive: true });
      }
    }
    writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    const childPackage = join(root, 'node_modules', 'consumer-hook-child');
    mkdirSync(childPackage, { recursive: true });
    writeFileSync(join(childPackage, 'package.json'), JSON.stringify({
      name: 'consumer-hook-child', version: '1.0.0', type: 'commonjs', main: 'index.js', dependencies: { react: '*' },
    }));
    writeFileSync(join(childPackage, 'index.js'), `
const React = require('react');
exports.Context = React.createContext('MISSING_PROVIDER');
exports.Child = function Child() {
  const [state] = React.useState('THIRD_PARTY_STATE');
  const context = React.useContext(exports.Context);
  return React.createElement('p', {
    'data-third-party-state': state, 'data-third-party-context': context,
    'data-child-file': __filename, 'data-child-directory': __dirname,
  }, state + ':' + context);
};
`);
    const consumerRequire = createRequire(join(root, 'package.json'));
    const consumerReact = realpathSync(consumerRequire.resolve('react'));
    if (installedConsumer) {
      expect(consumerReact.startsWith(join(installedConsumer, 'node_modules') + sep)).toBe(true);
    } else {
      expect(consumerReact.startsWith(join(root, 'node_modules') + sep)).toBe(true);
      expect(consumerReact).not.toBe(realpathSync(lumenRequire.resolve('react')));
    }
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'index.md'), '---\ntitle: Consumer hooks\nslug: /hook-probe\n---\n# Public hook document\n');
    writeFileSync(join(root, 'lumen.config.js'), `
import { createElement, useContext, useState } from 'react';
import thirdParty from 'consumer-hook-child';
const { Context, Child: ThirdPartyChild } = thirdParty;
function Child() {
  const [state] = useState('CONSUMER_STATE');
  const context = useContext(Context);
  return createElement('p', { 'data-consumer-state': state, 'data-consumer-context': context }, state + ':' + context);
}
export default {
  title: 'Consumer hooks', outDir: 'site',
  theme: { layout({ children }) {
    return createElement(Context.Provider, { value: 'CONSUMER_CONTEXT' },
      createElement('section', null, createElement(Child), createElement(ThirdPartyChild),
        createElement('code', {
          'data-config-url': import.meta.url,
          'data-config-directory': import.meta.dirname,
          'data-config-file': import.meta.filename,
        }, 'import.meta.url'), children));
  } },
};
`);

    // No source loader or resolver override: this is the package's shipped bin.
    const output = execFileSync(process.execPath, [join(lumenDirectory, 'bin/lumen.js'), 'build', '--root', root], {
      cwd: root, encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const html = readFileSync(join(root, 'site', 'hook-probe.html'), 'utf8');
    expect(html).toContain('data-consumer-state="CONSUMER_STATE"');
    expect(html).toContain('data-consumer-context="CONSUMER_CONTEXT"');
    expect(html).toContain('CONSUMER_STATE:CONSUMER_CONTEXT');
    expect(html).toContain('data-third-party-state="THIRD_PARTY_STATE"');
    expect(html).toContain('data-third-party-context="CONSUMER_CONTEXT"');
    expect(html).toContain('THIRD_PARTY_STATE:CONSUMER_CONTEXT');
    expect(html).toContain(`data-child-file="${join(childPackage, 'index.js')}"`);
    expect(html).toContain(`data-child-directory="${childPackage}"`);
    expect(html).toContain(`data-config-url="${pathToFileURL(join(root, 'lumen.config.js')).href}"`);
    expect(html).toContain(`data-config-directory="${root}"`);
    expect(html).toContain(`data-config-file="${join(root, 'lumen.config.js')}"`);
    expect(html).toContain('>import.meta.url</code>');
    expect(html).not.toContain('MISSING_PROVIDER');
    expect(html).toContain('Public hook document');
    const generation = JSON.parse(readFileSync(join(root, 'site', '.lumen-generation.json'), 'utf8'));
    expect(generation).toMatchObject({
      generator: '@omnitron-dev/lumen',
      files: { 'hook-probe.html': { bytes: Buffer.byteLength(html), sha256: createHash('sha256').update(html).digest('hex') } },
    });
    expect(output).not.toContain('Invalid hook call');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 90_000);
