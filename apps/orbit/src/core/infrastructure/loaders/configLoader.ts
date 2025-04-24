import { join } from 'path';

import { FileLoader } from '../../utils/fileLoader';
import { OrbitConfig, defaultOrbitConfig } from '../../config/orbitConfig';

export class InfrastructureConfigLoader {
  private config: OrbitConfig = { ...defaultOrbitConfig };

  constructor(private configDir: string) { }

  load(): void {
    const yamlPath = join(this.configDir, 'config.yaml');
    const jsonPath = join(this.configDir, 'config.json');

    if (FileLoader.fileExists(yamlPath)) {
      this.config = { ...this.config, ...FileLoader.loadFile(yamlPath) };
    } else if (FileLoader.fileExists(jsonPath)) {
      this.config = { ...this.config, ...FileLoader.loadFile(jsonPath) };
    } else {
      throw new Error(`No configuration file found in: ${this.configDir}`);
    }
  }

  getSettings(): OrbitConfig {
    return this.config;
  }
}
