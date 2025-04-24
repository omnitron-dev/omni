import { FileLoader } from '../utils/fileLoader';
import { OrbitConfig, defaultOrbitConfig } from './orbitConfig';

export class ConfigLoader {
  static loadFromFile(path: string): OrbitConfig {
    const configData = FileLoader.loadFile(path);
    return ConfigLoader.loadFromEnv({ ...defaultOrbitConfig, ...configData });
  }

  // Метод для загрузки конфигурации из переменных окружения
  static loadFromEnv(config: OrbitConfig = defaultOrbitConfig): OrbitConfig {
    const envConfig: OrbitConfig = {
      parallelLimit: process.env["ORBIT_PARALLEL_LIMIT"] ? parseInt(process.env["ORBIT_PARALLEL_LIMIT"], 10) : undefined,
      defaultTimeout: process.env["ORBIT_DEFAULT_TIMEOUT"] ? parseInt(process.env["ORBIT_DEFAULT_TIMEOUT"], 10) : undefined,
      dryRun: process.env["ORBIT_DRY_RUN"] ? process.env["ORBIT_DRY_RUN"] === 'true' : undefined,
      logLevel: process.env["ORBIT_LOG_LEVEL"] as OrbitConfig['logLevel'] | undefined,
      logFormat: process.env["ORBIT_LOG_FORMAT"] as OrbitConfig['logFormat'] | undefined,
    };

    // Убираем неопределённые значения
    Object.keys(envConfig).forEach(
      key => envConfig[key as keyof OrbitConfig] === undefined && delete envConfig[key as keyof OrbitConfig]
    );

    return { ...config, ...envConfig };
  }
}
