# Multi-stage build for Meridian MCP Server
FROM rust:1.90-slim as builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy manifests
COPY Cargo.toml Cargo.lock ./

# Copy source code
COPY src ./src
COPY benches ./benches

# Build for release
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user
RUN useradd -m -u 1000 meridian

# Create data directory
RUN mkdir -p /data/.meridian && chown -R meridian:meridian /data

# Copy the binary from builder
COPY --from=builder /app/target/release/meridian /usr/local/bin/meridian

# Set ownership
RUN chown meridian:meridian /usr/local/bin/meridian

# Switch to non-root user
USER meridian

# Set working directory
WORKDIR /data

# Expose port for HTTP transport (if needed)
EXPOSE 3000

# Default to STDIO mode (standard MCP)
CMD ["meridian", "serve", "--stdio"]
