/**
 * Unit tests for Docker detection logic
 */

import { execSync } from 'child_process';

// Import DockerTestManager at the top
import { DockerTestManager } from './docker-test-manager';

describe('Docker Detection', () => {
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    // Save the original platform descriptor
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  });

  afterEach(() => {
    // Restore the original platform
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
    // Clear the singleton instance
    (DockerTestManager as any).instance = undefined;
  });

  describe('Platform Detection', () => {
    it('should detect the current platform correctly', () => {
      expect(process.platform).toBeDefined();
      expect(['darwin', 'linux', 'win32']).toContain(process.platform);
    });

    it('should return platform-specific Docker paths for macOS', () => {
      // Create a partial mock to test just the getDockerFallbackPaths method
      const TestManager = DockerTestManager as any;
      const originalPlatform = process.platform;

      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

      // Create instance directly accessing the class prototype
      const instance = Object.create(TestManager.prototype);
      const paths = instance.getDockerFallbackPaths();

      expect(paths).toContain('/usr/local/bin/docker');
      expect(paths).toContain('/opt/homebrew/bin/docker');
      expect(paths).toContain('/Applications/Docker.app/Contents/Resources/bin/docker');

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('should return platform-specific Docker paths for Linux', () => {
      const TestManager = DockerTestManager as any;
      const originalPlatform = process.platform;

      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      const instance = Object.create(TestManager.prototype);
      const paths = instance.getDockerFallbackPaths();

      expect(paths).toContain('/usr/bin/docker');
      expect(paths).toContain('/usr/local/bin/docker');
      expect(paths).toContain('/snap/bin/docker');

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('should return platform-specific Docker paths for Windows', () => {
      const TestManager = DockerTestManager as any;
      const originalPlatform = process.platform;

      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      const instance = Object.create(TestManager.prototype);
      const paths = instance.getDockerFallbackPaths();

      expect(paths).toContain('docker.exe');
      expect(paths.some((p) => p.includes('Program Files'))).toBe(true);

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });
  });

  describe('Docker Path Validation', () => {
    it('should auto-detect Docker when available', () => {
      // Clear any existing singleton before test
      (DockerTestManager as any).instance = undefined;

      // Try to create instance - if Docker is available anywhere, this should succeed
      try {
        const manager = DockerTestManager.getInstance();
        expect(manager).toBeDefined();
        expect((manager as any).dockerPath).toBeTruthy();

        // Verify the found path actually works
        const dockerPath = (manager as any).dockerPath;
        expect(dockerPath).toBeTruthy();

        // The path should either be absolute or just 'docker'/'docker.exe'
        expect(
          dockerPath === 'docker' ||
            dockerPath === 'docker.exe' ||
            dockerPath.includes('/') ||
            dockerPath.includes('\\')
        ).toBe(true);
      } catch (error: any) {
        // If this fails, Docker is not available - that's ok for this test environment
        // The error should be descriptive
        expect(error.message).toContain('Docker executable not found');
      }
    });

    it('should provide helpful error message when Docker is not found', () => {
      // Test the error message format by creating a mock instance
      const TestManager = DockerTestManager as any;
      const instance = Object.create(TestManager.prototype);
      instance.dockerPath = '/nonexistent/docker/path';

      expect(() => instance.verifyDocker()).toThrow(/Docker is not available at path/);
      expect(() => instance.verifyDocker()).toThrow(/nonexistent/);
    });
  });

  describe('Custom Docker Path', () => {
    it('should accept custom Docker path in options', () => {
      let dockerPath: string;
      try {
        // Find the actual Docker path
        const result = execSync('which docker', { encoding: 'utf8' }).trim();
        dockerPath = result.split('\n')[0];
      } catch {
        // If which fails, skip this test
        return;
      }

      const manager = DockerTestManager.getInstance({ dockerPath });
      expect((manager as any).dockerPath).toBe(dockerPath);
    });
  });

  describe('Error Handling', () => {
    it('should throw helpful error with searched paths when Docker not found', () => {
      // Create an instance and mock testDockerPath to always return false
      const TestManager = DockerTestManager as any;
      const instance = Object.create(TestManager.prototype);

      // Mock testDockerPath to always return false
      instance.testDockerPath = () => false;

      try {
        instance.findDockerPath();
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toContain('Docker executable not found');
        expect(error.message).toContain('Searched paths:');
        expect(error.message).toContain(process.platform);
        expect(error.message).toContain('https://docs.docker.com/get-docker/');
      }
    });
  });

  describe('Docker Binary Name', () => {
    it('should use docker.exe on Windows', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      const TestManager = DockerTestManager as any;
      const instance = Object.create(TestManager.prototype);
      instance.testDockerPath = () => false; // Mock to prevent actual execution

      try {
        instance.findDockerPath();
      } catch (error: any) {
        // Should reference docker.exe in error message
        expect(error.message).toContain('docker.exe');
      }

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('should use docker on Unix-like systems', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      const TestManager = DockerTestManager as any;
      const instance = Object.create(TestManager.prototype);
      instance.testDockerPath = () => false;

      try {
        instance.findDockerPath();
      } catch (error: any) {
        // Should reference 'which docker' in error message
        expect(error.message).toContain('which docker');
        expect(error.message).not.toContain('docker.exe');
      }

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });
  });
});
