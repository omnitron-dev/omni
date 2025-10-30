import { execSync, execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import * as net from 'net';
export class DockerTestManager {
    constructor(options = {}) {
        this.containers = new Map();
        this.usedPorts = new Set();
        this.networks = new Set();
        this.dockerPath = options.dockerPath || this.findDockerPath();
        this.basePort = options.basePort || 10000;
        this.maxRetries = options.maxRetries || 20;
        this.startupTimeout = options.startupTimeout || 30000;
        this.cleanup = options.cleanup !== false;
        this.verbose = options.verbose || false;
        this.defaultNetwork = options.network;
        this.verifyDocker();
        if (this.cleanup) {
            process.on('exit', () => this.cleanupSync());
            process.on('SIGINT', () => this.cleanupAllAsync().then(() => process.exit(0)));
            process.on('SIGTERM', () => this.cleanupAllAsync().then(() => process.exit(0)));
        }
    }
    static getInstance(options) {
        if (!DockerTestManager.instance) {
            DockerTestManager.instance = new DockerTestManager(options);
        }
        return DockerTestManager.instance;
    }
    findDockerPath() {
        const isWindows = process.platform === 'win32';
        const whichCommand = isWindows ? 'where' : 'which';
        const dockerBinary = isWindows ? 'docker.exe' : 'docker';
        try {
            const result = execSync(`${whichCommand} ${dockerBinary}`, {
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'ignore'],
            }).trim();
            const dockerPath = result.split('\n')[0].trim();
            if (dockerPath && this.testDockerPath(dockerPath)) {
                if (this.verbose) {
                    console.log(`Found Docker in PATH: ${dockerPath}`);
                }
                return dockerPath;
            }
        }
        catch {
        }
        const fallbackPaths = this.getDockerFallbackPaths();
        for (const path of fallbackPaths) {
            if (this.testDockerPath(path)) {
                if (this.verbose) {
                    console.log(`Found Docker at fallback path: ${path}`);
                }
                return path;
            }
        }
        if (this.testDockerPath(dockerBinary)) {
            if (this.verbose) {
                console.log(`Using Docker from PATH: ${dockerBinary}`);
            }
            return dockerBinary;
        }
        throw new Error(`Docker executable not found. Please install Docker and ensure it's in your PATH.\n` +
            `Searched paths:\n` +
            `  - PATH using '${whichCommand} ${dockerBinary}'\n` +
            `  - ${fallbackPaths.join('\n  - ')}\n` +
            `\n` +
            `Platform: ${process.platform}\n` +
            `For more information, visit: https://docs.docker.com/get-docker/`);
    }
    getDockerFallbackPaths() {
        switch (process.platform) {
            case 'darwin':
                return [
                    '/usr/local/bin/docker',
                    '/opt/homebrew/bin/docker',
                    '/Applications/Docker.app/Contents/Resources/bin/docker',
                ];
            case 'linux':
                return [
                    '/usr/bin/docker',
                    '/usr/local/bin/docker',
                    '/snap/bin/docker',
                    '/var/lib/snapd/snap/bin/docker',
                    '/opt/docker/bin/docker',
                ];
            case 'win32':
                return [
                    'docker.exe',
                    'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
                    'C:\\ProgramData\\DockerDesktop\\version-bin\\docker.exe',
                ];
            default:
                return ['/usr/local/bin/docker', '/usr/bin/docker', 'docker'];
        }
    }
    testDockerPath(dockerPath) {
        try {
            execSync(`"${dockerPath}" version`, {
                stdio: 'ignore',
                timeout: 5000,
            });
            return true;
        }
        catch {
            return false;
        }
    }
    verifyDocker() {
        try {
            execSync(`"${this.dockerPath}" version`, { stdio: 'ignore' });
        }
        catch {
            throw new Error(`Docker is not available at path: ${this.dockerPath}\n` +
                `Please install Docker or verify it's properly configured.\n` +
                `Visit: https://docs.docker.com/get-docker/`);
        }
    }
    async findAvailablePort() {
        for (let i = 0; i < this.maxRetries; i++) {
            const port = this.basePort + Math.floor(Math.random() * 10000);
            if (!this.usedPorts.has(port) && (await this.isPortAvailable(port))) {
                this.usedPorts.add(port);
                return port;
            }
        }
        throw new Error('Could not find available port for container');
    }
    async isPortAvailable(port) {
        return new Promise((resolve) => {
            const server = net.createServer();
            server.once('error', () => resolve(false));
            server.once('listening', () => {
                server.close();
                resolve(true);
            });
            server.listen(port, '127.0.0.1');
        });
    }
    async createContainer(options) {
        const id = `test-${randomBytes(4).toString('hex')}`;
        const name = options.name || `container-${id}`;
        const host = '127.0.0.1';
        const portMappings = new Map();
        if (options.ports) {
            for (const [containerPort, hostPort] of Object.entries(options.ports)) {
                const cPort = parseInt(containerPort);
                const hPort = hostPort === 'auto' ? await this.findAvailablePort() : hostPort;
                portMappings.set(cPort, hPort);
            }
        }
        const dockerArgs = ['run', '-d', '--name', name];
        for (const [containerPort, hostPort] of portMappings) {
            dockerArgs.push('-p', `${hostPort}:${containerPort}`);
        }
        const environment = options.environment || {};
        for (const [key, value] of Object.entries(environment)) {
            dockerArgs.push('-e', `${key}=${value}`);
        }
        const labels = {
            'test.id': id,
            'test.cleanup': 'true',
            ...options.labels,
        };
        for (const [key, value] of Object.entries(labels)) {
            dockerArgs.push('--label', `${key}=${value}`);
        }
        if (options.volumes) {
            for (const volume of options.volumes) {
                dockerArgs.push('-v', volume);
            }
        }
        const networks = options.networks || (this.defaultNetwork ? [this.defaultNetwork] : []);
        for (const network of networks) {
            await this.ensureNetwork(network);
            dockerArgs.push('--network', network);
        }
        if (options.healthcheck) {
            let healthCmd;
            if (Array.isArray(options.healthcheck.test)) {
                if (options.healthcheck.test[0] === 'CMD-SHELL' || options.healthcheck.test[0] === 'CMD') {
                    healthCmd = options.healthcheck.test.slice(1).join(' ');
                }
                else {
                    healthCmd = options.healthcheck.test.join(' ');
                }
            }
            else {
                healthCmd = options.healthcheck.test;
            }
            dockerArgs.push('--health-cmd', healthCmd);
            if (options.healthcheck.interval) {
                dockerArgs.push('--health-interval', options.healthcheck.interval);
            }
            if (options.healthcheck.timeout) {
                dockerArgs.push('--health-timeout', options.healthcheck.timeout);
            }
            if (options.healthcheck.retries) {
                dockerArgs.push('--health-retries', options.healthcheck.retries.toString());
            }
            if (options.healthcheck.startPeriod) {
                dockerArgs.push('--health-start-period', options.healthcheck.startPeriod);
            }
        }
        dockerArgs.push(options.image);
        if (options.command) {
            dockerArgs.push('sh', '-c', options.command);
        }
        if (this.verbose) {
            console.log(`Starting container ${name}: docker ${dockerArgs.join(' ')}`);
        }
        try {
            execFileSync(this.dockerPath, dockerArgs, {
                stdio: this.verbose ? 'inherit' : 'ignore',
            });
        }
        catch (error) {
            throw new Error(`Failed to start container ${name}: ${error}`);
        }
        if (options.waitFor) {
            await this.waitForContainer(name, options.waitFor);
        }
        const container = {
            id,
            name,
            image: options.image,
            host,
            port: portMappings.values().next().value,
            ports: portMappings,
            environment,
            labels,
            networks,
            cleanup: async () => {
                if (this.verbose) {
                    console.log(`Cleaning up container: ${name}`);
                }
                try {
                    execSync(`"${this.dockerPath}" stop ${name}`, { stdio: 'ignore' });
                    execSync(`"${this.dockerPath}" rm ${name}`, { stdio: 'ignore' });
                }
                catch (error) {
                    console.warn(`Failed to cleanup container ${name}: ${error}`);
                }
                for (const port of portMappings.values()) {
                    this.usedPorts.delete(port);
                }
                this.containers.delete(id);
            },
        };
        this.containers.set(id, container);
        return container;
    }
    async ensureNetwork(network) {
        if (!this.networks.has(network)) {
            try {
                execSync(`"${this.dockerPath}" network create ${network} --label test.cleanup=true`, { stdio: 'ignore' });
                this.networks.add(network);
            }
            catch {
                this.networks.add(network);
            }
        }
    }
    async waitForContainer(name, options) {
        const startTime = Date.now();
        const timeout = options?.timeout || this.startupTimeout;
        while (Date.now() - startTime < timeout) {
            if (options?.healthcheck) {
                try {
                    const healthStatus = execSync(`"${this.dockerPath}" inspect --format='{{.State.Health.Status}}' ${name}`, {
                        encoding: 'utf8',
                    }).trim();
                    if (healthStatus === 'healthy') {
                        return;
                    }
                }
                catch {
                }
            }
            if (options?.port) {
                const containerInfo = this.containers.get(name);
                if (containerInfo) {
                    const hostPort = containerInfo.ports.get(options.port);
                    if (hostPort && (await this.isPortListening('127.0.0.1', hostPort))) {
                        return;
                    }
                }
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(`Container ${name} failed to start within ${timeout}ms`);
    }
    async isPortListening(host, port) {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(100);
            socket.on('connect', () => {
                socket.destroy();
                resolve(true);
            });
            socket.on('timeout', () => {
                socket.destroy();
                resolve(false);
            });
            socket.on('error', () => {
                resolve(false);
            });
            socket.connect(port, host);
        });
    }
    async getContainer(id) {
        return this.containers.get(id);
    }
    async cleanupContainer(id) {
        const container = this.containers.get(id);
        if (container) {
            await container.cleanup();
        }
    }
    async cleanupAll() {
        const cleanupPromises = Array.from(this.containers.values()).map((container) => container.cleanup());
        await Promise.all(cleanupPromises);
        for (const network of this.networks) {
            try {
                execSync(`"${this.dockerPath}" network rm ${network}`, { stdio: 'ignore' });
            }
            catch {
            }
        }
        this.containers.clear();
        this.usedPorts.clear();
        this.networks.clear();
    }
    async cleanupAllAsync() {
        if (this.verbose) {
            console.log('Cleaning up all test containers...');
        }
        await this.cleanupAll();
    }
    cleanupSync() {
        try {
            const isWindows = process.platform === 'win32';
            const xargsCmd = isWindows ? '' : 'xargs -r';
            if (isWindows) {
                try {
                    execSync(`"${this.dockerPath}" ps -a --filter "label=test.cleanup=true" -q --format "{{.ID}}" | ForEach-Object { "${this.dockerPath}" rm -f $_ }`, { stdio: 'ignore', shell: 'powershell.exe' });
                }
                catch {
                    try {
                        const containerIds = execSync(`"${this.dockerPath}" ps -a --filter "label=test.cleanup=true" -q`, {
                            encoding: 'utf8',
                            stdio: ['pipe', 'pipe', 'ignore'],
                        }).trim();
                        if (containerIds) {
                            containerIds.split('\n').forEach((id) => {
                                try {
                                    execSync(`"${this.dockerPath}" rm -f ${id.trim()}`, { stdio: 'ignore' });
                                }
                                catch {
                                }
                            });
                        }
                    }
                    catch {
                    }
                }
            }
            else {
                execSync(`"${this.dockerPath}" ps -a --filter "label=test.cleanup=true" -q | ${xargsCmd} "${this.dockerPath}" rm -f`, { stdio: 'ignore' });
                execSync(`"${this.dockerPath}" network ls --filter "label=test.cleanup=true" -q | ${xargsCmd} "${this.dockerPath}" network rm`, { stdio: 'ignore' });
                execSync(`"${this.dockerPath}" volume ls --filter "label=test.cleanup=true" -q | ${xargsCmd} "${this.dockerPath}" volume rm`, { stdio: 'ignore' });
            }
        }
        catch {
        }
    }
    static async withContainer(options, testFn) {
        const manager = DockerTestManager.getInstance();
        const container = await manager.createContainer(options);
        try {
            return await testFn(container);
        }
        finally {
            await container.cleanup();
        }
    }
}
export class DatabaseTestManager {
    static { this.dockerManager = DockerTestManager.getInstance(); }
    static async createPostgresContainer(options) {
        const port = options?.port || 'auto';
        const database = options?.database || 'testdb';
        const user = options?.user || 'testuser';
        const password = options?.password || 'testpass';
        return DatabaseTestManager.dockerManager.createContainer({
            name: options?.name,
            image: 'postgres:16-alpine',
            ports: { 5432: port },
            environment: {
                POSTGRES_DB: database,
                POSTGRES_USER: user,
                POSTGRES_PASSWORD: password,
                POSTGRES_HOST_AUTH_METHOD: 'trust',
            },
            healthcheck: {
                test: ['CMD-SHELL', `pg_isready -U ${user}`],
                interval: '1s',
                timeout: '3s',
                retries: 5,
                startPeriod: '2s',
            },
            waitFor: {
                healthcheck: true,
                timeout: 30000,
            },
        });
    }
    static async createMySQLContainer(options) {
        const port = options?.port || 'auto';
        const database = options?.database || 'testdb';
        const user = options?.user || 'testuser';
        const password = options?.password || 'testpass';
        const rootPassword = options?.rootPassword || 'rootpass';
        return DatabaseTestManager.dockerManager.createContainer({
            name: options?.name,
            image: 'mysql:8.0',
            ports: { 3306: port },
            environment: {
                MYSQL_DATABASE: database,
                MYSQL_USER: user,
                MYSQL_PASSWORD: password,
                MYSQL_ROOT_PASSWORD: rootPassword,
                MYSQL_ALLOW_EMPTY_PASSWORD: 'yes',
            },
            healthcheck: {
                test: ['CMD', 'mysqladmin', 'ping', '-h', 'localhost'],
                interval: '1s',
                timeout: '3s',
                retries: 10,
                startPeriod: '5s',
            },
            waitFor: {
                healthcheck: true,
                timeout: 30000,
            },
        });
    }
    static async withPostgres(testFn, options) {
        const container = await DatabaseTestManager.createPostgresContainer(options);
        const port = container.ports.get(5432);
        const database = options?.database || 'testdb';
        const user = options?.user || 'testuser';
        const password = options?.password || 'testpass';
        const connectionString = `postgresql://${user}:${password}@localhost:${port}/${database}`;
        try {
            return await testFn(container, connectionString);
        }
        finally {
            await container.cleanup();
        }
    }
    static async withMySQL(testFn, options) {
        const container = await DatabaseTestManager.createMySQLContainer(options);
        const port = container.ports.get(3306);
        const database = options?.database || 'testdb';
        const user = options?.user || 'testuser';
        const password = options?.password || 'testpass';
        const connectionString = `mysql://${user}:${password}@localhost:${port}/${database}`;
        try {
            return await testFn(container, connectionString);
        }
        finally {
            await container.cleanup();
        }
    }
}
//# sourceMappingURL=docker-test-manager.js.map