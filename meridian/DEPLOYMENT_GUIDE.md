# Meridian Deployment Guide

## Overview

This guide provides instructions for deploying and running the Meridian MCP server in various environments.

## Deployment Modes

### 1. HTTP/SSE Mode (Recommended for Claude Code)

#### Quick Start

```bash
# Navigate to meridian directory
cd /path/to/meridian

# Start server using convenience script
./start_server.sh
```

#### Manual Start

```bash
# Build release binary
cargo build --release

# Start HTTP server
./target/release/meridian serve --http
```

#### Verify Deployment

```bash
# Health check
curl http://127.0.0.1:3000/health

# Should return:
# {"status":"ok","service":"meridian-mcp","version":"0.1.0"}

# Test MCP protocol
curl -X POST http://127.0.0.1:3000/mcp/request \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

#### Configuration

Edit `meridian.toml`:

```toml
[mcp.http]
enabled = true
host = "127.0.0.1"    # Bind address
port = 3000            # Port number
cors_origins = ["*"]   # CORS configuration
max_connections = 100  # Max concurrent connections
```

### 2. STDIO Mode (For Direct Integration)

#### Start Server

```bash
./target/release/meridian serve --stdio
```

#### Configuration

Create `.claude/mcp_config.json`:

```json
{
  "mcpServers": {
    "meridian": {
      "command": "/absolute/path/to/meridian",
      "args": ["serve", "--stdio"],
      "transport": "stdio",
      "env": {
        "RUST_LOG": "info"
      }
    }
  }
}
```

## Production Deployment

### System Requirements

- **OS**: Linux, macOS, or Windows
- **RAM**: Minimum 512MB, recommended 2GB+
- **Disk**: 100MB for binary + storage for index (depends on codebase size)
- **CPU**: 2+ cores recommended

### Building for Production

```bash
# Build with optimizations
cargo build --release --locked

# Binary will be at: target/release/meridian
# Size: ~40-50MB

# Optional: Strip symbols for smaller size
strip target/release/meridian
# Reduced size: ~20-30MB
```

### Running as a Service

#### Linux (systemd)

Create `/etc/systemd/system/meridian.service`:

```ini
[Unit]
Description=Meridian MCP Server
After=network.target

[Service]
Type=simple
User=meridian
Group=meridian
WorkingDirectory=/opt/meridian
ExecStart=/opt/meridian/meridian serve --http
Restart=on-failure
RestartSec=5s

# Environment
Environment="RUST_LOG=info"
Environment="MERIDIAN_CONFIG=/opt/meridian/meridian.toml"

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/meridian/.meridian

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable meridian
sudo systemctl start meridian
sudo systemctl status meridian
```

#### macOS (launchd)

Create `~/Library/LaunchAgents/com.omnitron.meridian.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.omnitron.meridian</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/meridian</string>
        <string>serve</string>
        <string>--http</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/username/meridian</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/meridian.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/meridian.error.log</string>
</dict>
</plist>
```

Load and start:

```bash
launchctl load ~/Library/LaunchAgents/com.omnitron.meridian.plist
launchctl start com.omnitron.meridian
```

### Docker Deployment

Create `Dockerfile`:

```dockerfile
FROM rust:1.75 as builder

WORKDIR /build
COPY . .
RUN cargo build --release --locked

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/target/release/meridian /usr/local/bin/
COPY meridian.toml /etc/meridian/meridian.toml

WORKDIR /data
VOLUME ["/data/.meridian"]

EXPOSE 3000

ENTRYPOINT ["meridian"]
CMD ["serve", "--http"]
```

Build and run:

```bash
# Build image
docker build -t meridian:latest .

# Run container
docker run -d \
  --name meridian \
  -p 3000:3000 \
  -v $(pwd)/.meridian:/data/.meridian \
  meridian:latest

# Check logs
docker logs -f meridian
```

### Docker Compose

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  meridian:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./meridian.toml:/etc/meridian/meridian.toml:ro
      - meridian-data:/data/.meridian
    restart: unless-stopped
    environment:
      - RUST_LOG=info
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  meridian-data:
```

Start services:

```bash
docker-compose up -d
docker-compose ps
docker-compose logs -f
```

## Monitoring

### Health Checks

```bash
# HTTP endpoint
curl http://127.0.0.1:3000/health

# Server info
curl http://127.0.0.1:3000/mcp/info
```

### Logs

```bash
# Run with debug logging
RUST_LOG=debug ./target/release/meridian serve --http

# Production logging levels:
# - error: Only errors
# - warn: Warnings and errors
# - info: General information (recommended)
# - debug: Detailed debugging
# - trace: Very verbose
```

### Metrics

The server exposes metrics via the `/mcp/info` endpoint:

```bash
curl http://127.0.0.1:3000/mcp/info | jq
```

Returns:
```json
{
  "server": "meridian-mcp",
  "version": "0.1.0",
  "protocol_version": "2024-11-05",
  "transport": "http/sse",
  "projects": 0,
  "active_sessions": 0,
  "max_connections": 100
}
```

## Security Considerations

### Network Security

1. **Bind to localhost only** (default):
   ```toml
   [mcp.http]
   host = "127.0.0.1"  # Localhost only
   ```

2. **Use reverse proxy** for external access:
   ```nginx
   server {
       listen 443 ssl;
       server_name meridian.example.com;

       ssl_certificate /path/to/cert.pem;
       ssl_certificate_key /path/to/key.pem;

       location /mcp {
           proxy_pass http://127.0.0.1:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
       }
   }
   ```

### File System Security

1. **Limit read access**:
   - Configure `ignore` patterns in `meridian.toml`
   - Run as dedicated user with limited permissions

2. **Protect storage**:
   ```bash
   chmod 700 .meridian/
   chown meridian:meridian .meridian/
   ```

### CORS Configuration

For production, restrict CORS origins:

```toml
[mcp.http]
cors_origins = [
    "http://localhost:3000",
    "https://your-app.example.com"
]
```

## Performance Tuning

### RocksDB Tuning

```toml
[storage]
cache_size = "512MB"  # Increase for large codebases
```

### Memory Configuration

```toml
[memory]
working_memory_size = "20MB"  # Increase for more symbols
episodic_retention_days = 60   # Adjust based on needs
```

### Indexing Optimization

```toml
[index]
# Index only what you need
languages = ["rust", "typescript"]

# Aggressive ignore patterns
ignore = [
    "node_modules", "target", ".git",
    "dist", "build", ".next", "coverage",
    "vendor", "deps"
]
```

## Troubleshooting

### Server Won't Start

1. Check port availability:
   ```bash
   lsof -i :3000
   ```

2. Check configuration:
   ```bash
   cat meridian.toml
   ```

3. Check logs:
   ```bash
   RUST_LOG=debug ./target/release/meridian serve --http
   ```

### High Memory Usage

1. Reduce cache size in `meridian.toml`
2. Add more ignore patterns
3. Limit working memory size

### Slow Performance

1. Increase cache size
2. Use SSD for storage
3. Ensure adequate RAM
4. Check for large ignored directories

## Backup and Restore

### Backup

```bash
# Backup index and memory
tar -czf meridian-backup-$(date +%Y%m%d).tar.gz .meridian/

# Backup configuration
cp meridian.toml meridian.toml.backup
```

### Restore

```bash
# Restore index
tar -xzf meridian-backup-YYYYMMDD.tar.gz

# Restart server
./start_server.sh
```

## Upgrading

### Minor Updates

```bash
# Backup current version
cp target/release/meridian target/release/meridian.old

# Pull updates
git pull

# Build new version
cargo build --release

# Restart server
./start_server.sh
```

### Major Updates

1. **Backup data**: Follow backup procedure
2. **Read CHANGELOG**: Check for breaking changes
3. **Update configuration**: Adjust `meridian.toml` if needed
4. **Test in staging**: Test with representative codebase
5. **Deploy to production**: Follow deployment procedure

## Support

- **Issues**: https://github.com/omnitron-dev/meridian/issues
- **Documentation**: See `specs/` directory
- **Community**: Discussion forums (TBD)
