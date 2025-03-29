import fs from 'fs';

import { getMachineId } from './utils';
import { CONFIG_FILE, OMNITRON_DIR } from './consts';

export interface OmnitronConfig {
  id?: string;
  listenHost?: string;
  listenPort?: number;
  taskTimeout?: number;
  taskOverwriteStrategy?: 'replace' | 'skip' | 'throw';
  connectTimeout?: number;
  requestTimeout?: number;
  streamTimeout?: number;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: OmnitronConfig = {
  id: `omnitron:${getMachineId()}`,
  listenHost: '127.0.0.1',
  listenPort: 8008,
  taskTimeout: 10000,
  taskOverwriteStrategy: 'replace',
  connectTimeout: 10000,
  requestTimeout: 60000,
  streamTimeout: 60000,
};

/**
 * Ensures that `~/.omnitron` directory exists.
 */
function ensureConfigDir(): void {
  if (!fs.existsSync(OMNITRON_DIR)) {
    fs.mkdirSync(OMNITRON_DIR, { recursive: true });
  }
}

/**
 * Validates the configuration object.
 */
function validateConfig(config: any): config is OmnitronConfig {
  if (typeof config !== 'object' || config === null) return false;

  if (config.listenHost && typeof config.listenHost !== 'string') return false;
  if (config.listenPort && typeof config.listenPort !== 'number') return false;
  if (config.taskTimeout && typeof config.taskTimeout !== 'number') return false;
  if (config.taskOverwriteStrategy && !['replace', 'skip', 'throw'].includes(config.taskOverwriteStrategy))
    return false;
  if (config.connectTimeout && typeof config.connectTimeout !== 'number') return false;
  if (config.requestTimeout && typeof config.requestTimeout !== 'number') return false;
  if (config.streamTimeout && typeof config.streamTimeout !== 'number') return false;

  return true;
}

/**
 * Loads the configuration file.
 */
let cachedConfig: OmnitronConfig | null = null;

export function loadConfig(useCache: boolean = true): OmnitronConfig {
  if (useCache && cachedConfig) {
    return cachedConfig;
  }

  ensureConfigDir();

  if (!fs.existsSync(CONFIG_FILE)) {
    saveConfig(DEFAULT_CONFIG);
    cachedConfig = DEFAULT_CONFIG;
    return DEFAULT_CONFIG;
  }

  try {
    const rawData = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(rawData);

    if (!validateConfig(config)) {
      console.error('❌ Invalid configuration format. Resetting to defaults.');
      saveConfig(DEFAULT_CONFIG);
      cachedConfig = DEFAULT_CONFIG;
      return DEFAULT_CONFIG;
    }

    cachedConfig = { ...DEFAULT_CONFIG, ...config };
    return cachedConfig;
  } catch (error: any) {
    console.error(`❌ Error loading config: ${error.message}`);
    cachedConfig = DEFAULT_CONFIG;
    return DEFAULT_CONFIG;
  }
}

/**
 * Saves the configuration file.
 */
export function saveConfig(config: OmnitronConfig): void {
  ensureConfigDir();

  if (!validateConfig(config)) {
    throw new Error('❌ Invalid configuration data.');
  }

  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log('✅ Configuration saved successfully.');
  } catch (error: any) {
    console.error(`❌ Error saving config: ${error.message}`);
  }
}

/**
 * Updates specific keys in the configuration file.
 */
export function updateConfig(updates: Partial<OmnitronConfig>): void {
  const config = loadConfig();
  const newConfig = { ...config, ...updates };

  saveConfig(newConfig);
}

/**
 * Resets the configuration to default values.
 */
export function resetConfig(): void {
  saveConfig(DEFAULT_CONFIG);
  console.log('✅ Configuration reset to default settings.');
}
