import type { DocusaurusConfigInput } from '../types.js';

export function extractKatexMacrosFromConfig(config: DocusaurusConfigInput): Record<string, string> {
  const macros: Record<string, string> = {};

  if (config.katexMacros && typeof config.katexMacros === 'object') {
    Object.assign(macros, config.katexMacros);
  }

  const scanPluginsList = (list?: unknown[]) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!Array.isArray(item)) continue;
      const options = item[1];
      if (options && typeof options === 'object') {
        const opts = options as Record<string, unknown>;
        if (opts['macros'] && typeof opts['macros'] === 'object') {
          Object.assign(macros, opts['macros'] as Record<string, string>);
        }
        if (Array.isArray(opts['rehypePlugins'])) {
          scanPluginsList(opts['rehypePlugins']);
        }
        if (opts['docs'] && typeof opts['docs'] === 'object') {
          const docsOpts = opts['docs'] as Record<string, unknown>;
          if (Array.isArray(docsOpts['rehypePlugins'])) {
            scanPluginsList(docsOpts['rehypePlugins']);
          }
        }
      }
    }
  };

  if (Array.isArray(config.presets)) {
    scanPluginsList(config.presets);
  }

  if (Array.isArray(config.plugins)) {
    scanPluginsList(config.plugins);
  }

  const customRehype = config['rehypePlugins'];
  if (Array.isArray(customRehype)) {
    scanPluginsList(customRehype);
  }

  return macros;
}
