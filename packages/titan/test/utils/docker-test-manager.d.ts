export interface DockerContainer {
    id: string;
    name: string;
    image: string;
    port?: number;
    host: string;
    ports: Map<number, number>;
    environment: Record<string, string>;
    labels: Record<string, string>;
    networks: string[];
    cleanup: () => Promise<void>;
}
export interface DockerTestManagerOptions {
    dockerPath?: string;
    basePort?: number;
    maxRetries?: number;
    startupTimeout?: number;
    cleanup?: boolean;
    verbose?: boolean;
    network?: string;
}
export interface ContainerOptions {
    name?: string;
    image: string;
    command?: string;
    ports?: Record<number, number | 'auto'>;
    environment?: Record<string, string>;
    labels?: Record<string, string>;
    volumes?: string[];
    networks?: string[];
    healthcheck?: {
        test: string[];
        interval?: string;
        timeout?: string;
        retries?: number;
        startPeriod?: string;
    };
    waitFor?: {
        port?: number;
        timeout?: number;
        healthcheck?: boolean;
    };
}
export declare class DockerTestManager {
    private static instance;
    private containers;
    private usedPorts;
    private networks;
    private dockerPath;
    private basePort;
    private maxRetries;
    private startupTimeout;
    private cleanup;
    private verbose;
    private defaultNetwork?;
    private constructor();
    static getInstance(options?: DockerTestManagerOptions): DockerTestManager;
    private findDockerPath;
    private getDockerFallbackPaths;
    private testDockerPath;
    private verifyDocker;
    private findAvailablePort;
    private isPortAvailable;
    createContainer(options: ContainerOptions): Promise<DockerContainer>;
    private ensureNetwork;
    private waitForContainer;
    private isPortListening;
    getContainer(id: string): Promise<DockerContainer | undefined>;
    cleanupContainer(id: string): Promise<void>;
    cleanupAll(): Promise<void>;
    private cleanupAllAsync;
    private cleanupSync;
    static withContainer<T>(options: ContainerOptions, testFn: (container: DockerContainer) => Promise<T>): Promise<T>;
}
export declare class DatabaseTestManager {
    private static dockerManager;
    static createPostgresContainer(options?: {
        name?: string;
        port?: number | 'auto';
        database?: string;
        user?: string;
        password?: string;
    }): Promise<DockerContainer>;
    static createMySQLContainer(options?: {
        name?: string;
        port?: number | 'auto';
        database?: string;
        user?: string;
        password?: string;
        rootPassword?: string;
    }): Promise<DockerContainer>;
    static withPostgres<T>(testFn: (container: DockerContainer, connectionString: string) => Promise<T>, options?: Parameters<typeof DatabaseTestManager.createPostgresContainer>[0]): Promise<T>;
    static withMySQL<T>(testFn: (container: DockerContainer, connectionString: string) => Promise<T>, options?: Parameters<typeof DatabaseTestManager.createMySQLContainer>[0]): Promise<T>;
}
//# sourceMappingURL=docker-test-manager.d.ts.map