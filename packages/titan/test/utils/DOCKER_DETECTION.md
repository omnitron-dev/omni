# Docker Detection System

## Overview

The `docker-test-manager.ts` module includes a robust, cross-platform Docker detection system that automatically finds the Docker executable across different operating systems and installation methods.

## Detection Strategy

The Docker detection uses a multi-layered approach to maximize compatibility:

### 1. Primary Detection (PATH-based)

First, the system attempts to find Docker in the system PATH using:
- **Unix-like systems** (macOS/Linux): `which docker`
- **Windows**: `where docker.exe`

This is the most reliable method when Docker is properly installed and configured in the system PATH.

### 2. Fallback Detection (Platform-specific paths)

If PATH detection fails, the system checks common installation locations specific to each platform:

#### macOS (darwin)
- `/usr/local/bin/docker` - Intel Mac / Docker Desktop default
- `/opt/homebrew/bin/docker` - Apple Silicon Mac / Homebrew installation
- `/Applications/Docker.app/Contents/Resources/bin/docker` - Docker Desktop app bundle

#### Linux
- `/usr/bin/docker` - Most common system installation
- `/usr/local/bin/docker` - Alternative installation location
- `/snap/bin/docker` - Snap package installation
- `/var/lib/snapd/snap/bin/docker` - Snap on some distributions
- `/opt/docker/bin/docker` - Custom installations

#### Windows (win32)
- `docker.exe` - Should be in PATH
- `C:\Program Files\Docker\Docker\resources\bin\docker.exe` - Docker Desktop
- `C:\ProgramData\DockerDesktop\version-bin\docker.exe` - Alternative Docker Desktop path

### 3. Validation

Each potential Docker path is validated by executing `docker version` with a 5-second timeout. Only paths that successfully execute are accepted.

## Error Handling

When Docker cannot be found, the system provides a comprehensive error message including:
- List of all searched paths
- The current platform
- The detection method used (which/where)
- Link to Docker installation documentation

Example error message:
```
Docker executable not found. Please install Docker and ensure it's in your PATH.
Searched paths:
  - PATH using 'which docker'
  - /usr/local/bin/docker
  - /opt/homebrew/bin/docker
  - /Applications/Docker.app/Contents/Resources/bin/docker

Platform: darwin
For more information, visit: https://docs.docker.com/get-docker/
```

## Usage

### Automatic Detection

The Docker path is automatically detected when creating a `DockerTestManager` instance:

```typescript
const manager = DockerTestManager.getInstance();
// Docker path is automatically detected and validated
```

### Custom Docker Path

You can override the auto-detection by providing a custom path:

```typescript
const manager = DockerTestManager.getInstance({
  dockerPath: '/custom/path/to/docker'
});
```

### Verbose Mode

Enable verbose logging to see which Docker path was detected:

```typescript
const manager = DockerTestManager.getInstance({ verbose: true });
// Logs: "Found Docker in PATH: /usr/local/bin/docker"
// or: "Found Docker at fallback path: /opt/homebrew/bin/docker"
```

## Testing

The detection logic is thoroughly tested in `docker-detection.spec.ts`:

1. **Platform-specific path lists**: Verifies correct paths are checked for each OS
2. **Auto-detection**: Tests that Docker is found when available
3. **Error messages**: Validates helpful error messages when Docker is not found
4. **Binary naming**: Ensures correct binary name (docker vs docker.exe) per platform
5. **Custom paths**: Tests that custom Docker paths work correctly

## Edge Cases Handled

1. **Multiple Docker installations**: Takes the first working path found
2. **Windows path handling**: Proper quoting for paths with spaces
3. **Missing Docker**: Clear error message with installation guidance
4. **Permission issues**: Timeout prevents hanging on permission-denied scenarios
5. **WSL/Cygwin**: Works correctly in Unix-like environments on Windows
6. **Docker Desktop updates**: Checks multiple version paths for Docker Desktop

## Cross-Platform Compatibility

### Command Execution
All Docker commands use proper path quoting to handle:
- Spaces in paths (common on Windows)
- Special characters
- Different path separators (/ vs \)

### Cleanup Commands
The cleanup sync method has platform-specific implementations:
- **Unix**: Uses `xargs` for efficient batch operations
- **Windows**: Uses PowerShell or fallback to individual operations

## Performance Considerations

1. **Caching**: The Docker path is determined once at initialization
2. **Fast validation**: 5-second timeout per path test prevents hanging
3. **Early exit**: Stops searching after first valid path is found
4. **Singleton pattern**: Detection runs only once per process

## Debugging

To debug Docker detection issues:

1. Set `verbose: true` in options
2. Check the error message for searched paths
3. Verify Docker is in your PATH: `which docker` or `where docker`
4. Try with explicit path: `dockerPath: '/path/to/docker'`
5. Run the test detection script: `npx tsx test/utils/test-docker-detection.ts`

## Future Enhancements

Potential improvements for the future:
- Podman support as a Docker alternative
- Detection of rootless Docker installations
- Support for custom Docker contexts
- Automatic fallback to Podman if Docker not found
- Caching of detection results across test runs
