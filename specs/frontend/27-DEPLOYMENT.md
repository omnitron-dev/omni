# 27. Deployment

## Table of Contents
- [Overview](#overview)
- [Build for Production](#build-for-production)
- [Static Hosting](#static-hosting)
- [Server Deployment](#server-deployment)
- [Serverless Deployment](#serverless-deployment)
- [Container Deployment](#container-deployment)
- [Edge Deployment](#edge-deployment)
- [Environment Variables](#environment-variables)
- [CI/CD Pipelines](#cicd-pipelines)
- [Zero-Downtime Deployment](#zero-downtime-deployment)
- [Scaling Strategies](#scaling-strategies)
- [Health Checks](#health-checks)
- [Performance Optimization](#performance-optimization)
- [Security](#security)
- [Monitoring](#monitoring)
- [Titan Backend Deployment](#titan-backend-deployment)
- [Examples](#examples)

## Overview

Nexus applications can be deployed in multiple ways depending on your rendering strategy and infrastructure requirements.

### Deployment Options

```typescript
/**
 * Deployment Strategies:
 *
 * 1. Static Hosting (SSG)
 *    - Pre-rendered at build time
 *    - Served from CDN
 *    - Best for: Blogs, documentation, marketing sites
 *    - Platforms: Netlify, Vercel, Cloudflare Pages, AWS S3
 *
 * 2. Server Deployment (SSR)
 *    - Rendered on-demand
 *    - Requires Node.js server
 *    - Best for: Dynamic content, personalization
 *    - Platforms: VPS, AWS EC2, Google Cloud Run, Railway
 *
 * 3. Serverless (SSR/SSG Hybrid)
 *    - Functions for dynamic routes
 *    - Static for pre-rendered pages
 *    - Best for: Scalable apps with mixed content
 *    - Platforms: Vercel, Netlify, AWS Lambda, Cloudflare Workers
 *
 * 4. Edge Deployment
 *    - SSR at the edge
 *    - Minimal latency
 *    - Best for: Global apps, real-time features
 *    - Platforms: Cloudflare Workers, Vercel Edge, Deno Deploy
 *
 * 5. Container Deployment (Docker/Kubernetes)
 *    - Containerized application
 *    - Orchestrated scaling
 *    - Best for: Enterprise, microservices
 *    - Platforms: AWS ECS, Google GKE, Azure AKS, DigitalOcean
 *
 * 6. Islands Architecture
 *    - Static HTML with selective hydration
 *    - Minimal JavaScript
 *    - Best for: Content-heavy sites
 *    - Platforms: Any static host + CDN
 */
```

### Rendering Strategy Decision

```typescript
// nexus.config.ts
export default defineConfig({
  output: 'static', // 'static' | 'server' | 'hybrid' | 'edge'

  // Static: Pre-render everything at build time
  // Server: SSR on every request
  // Hybrid: Mix of static and SSR
  // Edge: SSR at the edge

  adapter: 'auto', // Auto-detect or specify: 'node', 'vercel', 'netlify', 'cloudflare'

  prerender: {
    // Routes to pre-render in hybrid mode
    routes: ['/', '/about', '/blog/*']
  }
});
```

## Build for Production

### Production Build

```bash
# Build for production
npm run build

# Preview production build locally
npm run preview

# Build with specific adapter
ADAPTER=vercel npm run build
```

### Build Configuration

```typescript
// nexus.config.ts
export default defineConfig({
  build: {
    // Output directory
    outDir: 'dist',

    // Source maps for production debugging
    sourcemap: false,

    // Minification
    minify: 'esbuild', // 'esbuild' | 'terser' | false

    // Target browsers
    target: 'es2020',

    // Code splitting strategy
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks
          vendor: ['solid-js'],
          // Route chunks
          routes: ['./src/routes/*']
        }
      }
    },

    // Asset optimization
    assetsInlineLimit: 4096, // Inline assets smaller than 4KB

    // CSS code splitting
    cssCodeSplit: true,

    // Chunk size warnings
    chunkSizeWarningLimit: 500, // KB

    // Report compressed size
    reportCompressedSize: true
  }
});
```

### Build Output

```typescript
/**
 * Build Output Structure:
 *
 * dist/
 * ├── client/          # Client-side assets
 * │   ├── assets/      # JS, CSS, images
 * │   ├── index.html   # HTML entry point
 * │   └── manifest.json
 * ├── server/          # Server-side code (SSR only)
 * │   ├── entry.js
 * │   └── manifest.json
 * └── prerendered/     # Pre-rendered pages (SSG/Hybrid)
 *     ├── index.html
 *     └── about/index.html
 */
```

### Environment-Specific Builds

```typescript
// Production build
{
  "scripts": {
    "build": "nexus build",
    "build:staging": "NODE_ENV=staging nexus build",
    "build:production": "NODE_ENV=production nexus build"
  }
}

// Build-time environment variables
// vite automatically includes VITE_* variables
const apiUrl = import.meta.env.VITE_API_URL;

// Runtime environment variables (SSR only)
const secret = process.env.SECRET_KEY;
```

## Static Hosting

Deploy pre-rendered sites to static hosts.

### Netlify

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Deploy
netlify deploy --prod
```

```toml
# netlify.toml
[build]
  command = "npm run build"
  publish = "dist/client"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[build.environment]
  NODE_VERSION = "22"

# Headers for caching
[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
  for = "/*.html"
  [headers.values]
    Cache-Control = "public, max-age=0, must-revalidate"
```

### Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod
```

```json
// vercel.json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist/client",
  "framework": "nexus",
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    }
  ]
}
```

### Cloudflare Pages

```bash
# Deploy via Wrangler CLI
npm install -g wrangler

# Deploy
wrangler pages publish dist/client
```

```toml
# wrangler.toml
name = "my-nexus-app"
compatibility_date = "2024-01-01"

[site]
  bucket = "./dist/client"

[build]
  command = "npm run build"
  watch_dir = "src"

[[route]]
  pattern = "*"
  script = "worker"
```

### AWS S3 + CloudFront

```bash
# Build
npm run build

# Sync to S3
aws s3 sync dist/client s3://my-bucket --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id E1234567890 \
  --paths "/*"
```

```typescript
// AWS CDK deployment stack
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';

export class NexusStaticStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string) {
    super(scope, id);

    // S3 bucket
    const bucket = new s3.Bucket(this, 'NexusBucket', {
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      publicReadAccess: true
    });

    // CloudFront distribution
    const distribution = new cloudfront.CloudFrontWebDistribution(this, 'Distribution', {
      originConfigs: [{
        s3OriginSource: { s3BucketSource: bucket },
        behaviors: [
          {
            isDefaultBehavior: true,
            compress: true,
            allowedMethods: cloudfront.CloudFrontAllowedMethods.GET_HEAD_OPTIONS
          }
        ]
      }]
    });

    // Deploy to S3
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset('./dist/client')],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*']
    });
  }
}
```

## Server Deployment

Deploy SSR applications to Node.js servers.

### Node.js Server

```typescript
// server.ts
import { createServer } from '@nexus/server';
import express from 'express';
import compression from 'compression';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Middleware
app.use(compression());
app.use(express.static(join(__dirname, 'dist/client')));

// SSR handler
const { render } = await import('./dist/server/entry.js');

app.get('*', async (req, res) => {
  try {
    const { html, statusCode, headers } = await render({
      url: req.url,
      headers: req.headers
    });

    // Set headers
    Object.entries(headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    res.status(statusCode).send(html);
  } catch (error) {
    console.error('SSR Error:', error);
    res.status(500).send('Internal Server Error');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

### PM2 (Process Manager)

```bash
# Install PM2
npm install -g pm2

# Start application
pm2 start server.js --name nexus-app

# Start with ecosystem config
pm2 start ecosystem.config.js
```

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'nexus-app',
    script: './dist/server.js',
    instances: 'max', // Use all CPU cores
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    max_memory_restart: '1G',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    autorestart: true,
    watch: false,
    max_restarts: 10,
    min_uptime: '10s'
  }],

  deploy: {
    production: {
      user: 'deploy',
      host: 'example.com',
      ref: 'origin/main',
      repo: 'git@github.com:user/repo.git',
      path: '/var/www/nexus-app',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js'
    }
  }
};
```

### Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link project
railway link

# Deploy
railway up
```

```toml
# railway.toml
[build]
  builder = "NIXPACKS"
  buildCommand = "npm run build"

[deploy]
  startCommand = "npm run start"
  restartPolicyType = "ON_FAILURE"
  restartPolicyMaxRetries = 10

[[services]]
  name = "web"
  port = 3000
```

### DigitalOcean App Platform

```yaml
# .do/app.yaml
name: nexus-app
region: nyc

services:
  - name: web
    github:
      repo: user/repo
      branch: main
      deploy_on_push: true

    build_command: npm run build
    run_command: npm start

    envs:
      - key: NODE_ENV
        value: production

    http_port: 3000

    instance_count: 2
    instance_size_slug: basic-xs

    routes:
      - path: /
```

## Serverless Deployment

Deploy to serverless platforms.

### Vercel (Serverless Functions)

```typescript
// Automatic deployment - zero config needed
// Vercel detects Nexus and configures automatically

// vercel.json (optional customization)
{
  "framework": "nexus",
  "buildCommand": "npm run build",
  "devCommand": "npm run dev",
  "installCommand": "npm install",
  "regions": ["iad1", "sfo1"], // Deploy to multiple regions
  "env": {
    "DATABASE_URL": "@database-url"
  }
}
```

### Netlify Functions

```typescript
// netlify/edge-functions/ssr.ts
import { render } from '../../dist/server/entry.js';

export default async (request: Request) => {
  const url = new URL(request.url);

  const { html, statusCode, headers } = await render({
    url: url.pathname + url.search,
    headers: Object.fromEntries(request.headers)
  });

  return new Response(html, {
    status: statusCode,
    headers
  });
};

export const config = { path: '/*' };
```

```toml
# netlify.toml
[build]
  command = "npm run build"
  publish = "dist/client"

[[edge_functions]]
  function = "ssr"
  path = "/*"

[functions]
  node_bundler = "esbuild"
```

### AWS Lambda

```typescript
// lambda/handler.ts
import { APIGatewayProxyHandler } from 'aws-lambda';
import { render } from '../dist/server/entry.js';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const { html, statusCode, headers } = await render({
      url: event.path + (event.queryStringParameters ? '?' + new URLSearchParams(event.queryStringParameters).toString() : ''),
      headers: event.headers
    });

    return {
      statusCode,
      headers: {
        'Content-Type': 'text/html',
        ...headers
      },
      body: html
    };
  } catch (error) {
    console.error('Lambda SSR Error:', error);
    return {
      statusCode: 500,
      body: 'Internal Server Error'
    };
  }
};
```

```yaml
# serverless.yml
service: nexus-app

provider:
  name: aws
  runtime: nodejs22.x
  region: us-east-1
  memorySize: 1024
  timeout: 10

functions:
  ssr:
    handler: lambda/handler.handler
    events:
      - http:
          path: /{proxy+}
          method: ANY

plugins:
  - serverless-offline
```

### Cloudflare Workers

```typescript
// worker.ts
import { render } from './dist/server/entry.js';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Serve static assets from R2 or cache
    if (url.pathname.startsWith('/assets/')) {
      return env.ASSETS.fetch(request);
    }

    // SSR
    try {
      const { html, statusCode, headers } = await render({
        url: url.pathname + url.search,
        headers: Object.fromEntries(request.headers),
        env // Pass environment variables
      });

      return new Response(html, {
        status: statusCode,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          ...headers
        }
      });
    } catch (error) {
      console.error('Worker SSR Error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
};
```

```toml
# wrangler.toml
name = "nexus-app"
main = "worker.ts"
compatibility_date = "2024-01-01"

[build]
command = "npm run build"

[[r2_buckets]]
binding = "ASSETS"
bucket_name = "nexus-assets"

[site]
bucket = "./dist/client"
```

## Container Deployment

Deploy using Docker and Kubernetes.

### Docker

```dockerfile
# Dockerfile
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy source
COPY . .

# Build application
RUN yarn build

# Production image
FROM node:22-alpine

WORKDIR /app

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/server.js ./

# Install production dependencies only
RUN yarn install --production --frozen-lockfile

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Run application
CMD ["node", "server.js"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    build: .
    ports:
      - '3000:3000'
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
    restart: unless-stopped
    networks:
      - nexus-network

  nginx:
    image: nginx:alpine
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./dist/client:/usr/share/nginx/html
    depends_on:
      - app
    networks:
      - nexus-network

networks:
  nexus-network:
    driver: bridge
```

### Kubernetes

```yaml
# kubernetes/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nexus-app
  labels:
    app: nexus-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nexus-app
  template:
    metadata:
      labels:
        app: nexus-app
    spec:
      containers:
        - name: nexus-app
          image: myregistry/nexus-app:latest
          ports:
            - containerPort: 3000
          env:
            - name: NODE_ENV
              value: production
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: nexus-secrets
                  key: database-url
          resources:
            requests:
              memory: '512Mi'
              cpu: '500m'
            limits:
              memory: '1Gi'
              cpu: '1000m'
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /ready
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: nexus-app-service
spec:
  selector:
    app: nexus-app
  ports:
    - protocol: TCP
      port: 80
      targetPort: 3000
  type: LoadBalancer
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: nexus-app-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nexus-app
  minReplicas: 3
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

## Edge Deployment

Deploy to edge networks for minimal latency.

### Cloudflare Workers (Edge)

```typescript
// edge-worker.ts
import { render } from './dist/server/entry.js';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Cache static assets
    if (url.pathname.startsWith('/assets/')) {
      const cache = caches.default;
      let response = await cache.match(request);

      if (!response) {
        response = await env.ASSETS.fetch(request);
        ctx.waitUntil(cache.put(request, response.clone()));
      }

      return response;
    }

    // Edge SSR with caching
    const cacheKey = new Request(url.toString(), request);
    const cache = caches.default;

    let response = await cache.match(cacheKey);

    if (!response) {
      const { html, statusCode, headers } = await render({
        url: url.pathname + url.search,
        headers: Object.fromEntries(request.headers),
        env
      });

      response = new Response(html, {
        status: statusCode,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, s-maxage=60',
          ...headers
        }
      });

      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }

    return response;
  }
};
```

### Vercel Edge Functions

```typescript
// middleware.ts
import { next } from '@vercel/edge';

export const config = {
  matcher: '/:path*'
};

export default async function middleware(request: Request) {
  const url = new URL(request.url);

  // Custom edge logic
  const country = request.headers.get('x-vercel-ip-country');

  // Geolocation-based routing
  if (country === 'JP') {
    return Response.redirect(new URL('/ja' + url.pathname, url));
  }

  // Continue to SSR
  return next();
}
```

## Environment Variables

Manage environment-specific configuration.

### Build-Time Variables

```typescript
// .env
VITE_API_URL=https://api.example.com
VITE_APP_VERSION=1.0.0

// Access in code (bundled into output)
const apiUrl = import.meta.env.VITE_API_URL;

// Check environment
if (import.meta.env.DEV) {
  // Development only
}

if (import.meta.env.PROD) {
  // Production only
}
```

### Runtime Variables (SSR)

```typescript
// Server-side only (never exposed to client)
const databaseUrl = process.env.DATABASE_URL;
const secretKey = process.env.SECRET_KEY;

// Pass to client safely
export const getServerSideProps = async () => {
  return {
    props: {
      publicKey: process.env.PUBLIC_KEY // Only public data
    }
  };
};
```

### Environment Files

```bash
# .env.local (local development, gitignored)
DATABASE_URL=postgresql://localhost/dev
SECRET_KEY=dev-secret

# .env.production (production, gitignored)
DATABASE_URL=postgresql://prod-server/prod
SECRET_KEY=prod-secret

# .env.example (committed to git)
DATABASE_URL=
SECRET_KEY=
```

### Platform-Specific

```typescript
// Vercel
const isVercel = process.env.VERCEL === '1';

// Netlify
const isNetlify = process.env.NETLIFY === 'true';

// Cloudflare Workers
const isWorker = typeof Response !== 'undefined';

// Platform-specific config
const config = {
  vercel: { /* ... */ },
  netlify: { /* ... */ },
  cloudflare: { /* ... */ }
};

const platformConfig = isVercel ? config.vercel : isNetlify ? config.netlify : config.cloudflare;
```

## CI/CD Pipelines

Automate testing and deployment.

### GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'yarn'

      - name: Install dependencies
        run: yarn install --frozen-lockfile

      - name: Run linter
        run: yarn lint

      - name: Run tests
        run: yarn test

      - name: Build
        run: yarn build

  deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'yarn'

      - name: Install dependencies
        run: yarn install --frozen-lockfile

      - name: Build
        run: yarn build
        env:
          VITE_API_URL: ${{ secrets.API_URL }}

      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
```

### GitLab CI

```yaml
# .gitlab-ci.yml
stages:
  - test
  - build
  - deploy

variables:
  NODE_VERSION: '22'

cache:
  paths:
    - node_modules/
    - .yarn/

test:
  stage: test
  image: node:${NODE_VERSION}
  script:
    - yarn install --frozen-lockfile
    - yarn lint
    - yarn test
  coverage: '/All files[^|]*\|[^|]*\s+([\d\.]+)/'

build:
  stage: build
  image: node:${NODE_VERSION}
  script:
    - yarn install --frozen-lockfile
    - yarn build
  artifacts:
    paths:
      - dist/
    expire_in: 1 week
  only:
    - main

deploy:
  stage: deploy
  image: node:${NODE_VERSION}
  script:
    - npm install -g vercel
    - vercel --token $VERCEL_TOKEN --prod --yes
  only:
    - main
  environment:
    name: production
    url: https://myapp.vercel.app
```

### CircleCI

```yaml
# .circleci/config.yml
version: 2.1

orbs:
  node: circleci/node@5.0

jobs:
  test:
    docker:
      - image: cimg/node:22.0
    steps:
      - checkout
      - node/install-packages:
          pkg-manager: yarn
      - run:
          name: Run tests
          command: yarn test
      - run:
          name: Run linter
          command: yarn lint

  build:
    docker:
      - image: cimg/node:22.0
    steps:
      - checkout
      - node/install-packages:
          pkg-manager: yarn
      - run:
          name: Build application
          command: yarn build
      - persist_to_workspace:
          root: .
          paths:
            - dist

  deploy:
    docker:
      - image: cimg/node:22.0
    steps:
      - checkout
      - attach_workspace:
          at: .
      - run:
          name: Deploy to production
          command: npx vercel --token $VERCEL_TOKEN --prod --yes

workflows:
  test-build-deploy:
    jobs:
      - test
      - build:
          requires:
            - test
      - deploy:
          requires:
            - build
          filters:
            branches:
              only: main
```

## Zero-Downtime Deployment

Deploy without interrupting service.

### Blue-Green Deployment

```typescript
/**
 * Blue-Green Deployment:
 * 1. Deploy new version (green) alongside old version (blue)
 * 2. Test green environment
 * 3. Switch traffic to green
 * 4. Keep blue as rollback option
 */

// Kubernetes blue-green deployment
// deployment-blue.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nexus-app-blue
  labels:
    app: nexus-app
    version: blue
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nexus-app
      version: blue
  template:
    metadata:
      labels:
        app: nexus-app
        version: blue
    spec:
      containers:
        - name: nexus-app
          image: myregistry/nexus-app:v1.0.0
          # ...

// deployment-green.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nexus-app-green
  labels:
    app: nexus-app
    version: green
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nexus-app
      version: green
  template:
    metadata:
      labels:
        app: nexus-app
        version: green
    spec:
      containers:
        - name: nexus-app
          image: myregistry/nexus-app:v2.0.0
          # ...

// service.yaml - switch between blue/green
apiVersion: v1
kind: Service
metadata:
  name: nexus-app-service
spec:
  selector:
    app: nexus-app
    version: green # Change to 'blue' to rollback
  ports:
    - protocol: TCP
      port: 80
      targetPort: 3000
```

### Rolling Updates

```yaml
# Kubernetes rolling update
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nexus-app
spec:
  replicas: 10
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 2 # Max 2 pods above desired count
      maxUnavailable: 1 # Max 1 pod unavailable during update
  template:
    # ...
```

### Canary Deployment

```typescript
/**
 * Canary Deployment:
 * 1. Deploy new version to small percentage of traffic
 * 2. Monitor metrics
 * 3. Gradually increase traffic to new version
 * 4. Rollback if issues detected
 */

// Nginx canary routing
// nginx.conf
upstream backend_stable {
  server app-v1:3000;
}

upstream backend_canary {
  server app-v2:3000;
}

split_clients "${remote_addr}" $backend {
  10% backend_canary;  # 10% traffic to canary
  *   backend_stable;  # 90% traffic to stable
}

server {
  location / {
    proxy_pass http://$backend;
  }
}
```

## Scaling Strategies

Scale your application to handle load.

### Horizontal Scaling

```yaml
# Kubernetes HorizontalPodAutoscaler
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: nexus-app-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nexus-app
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 50
          periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 100
          periodSeconds: 15
```

### Load Balancing

```nginx
# Nginx load balancer
upstream nexus_backend {
  least_conn; # Load balancing method

  server app1:3000 weight=3;
  server app2:3000 weight=2;
  server app3:3000 weight=1;

  # Health checks
  server app1:3000 max_fails=3 fail_timeout=30s;
}

server {
  listen 80;

  location / {
    proxy_pass http://nexus_backend;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    # Connection pooling
    proxy_http_version 1.1;
    proxy_set_header Connection "";

    # Timeouts
    proxy_connect_timeout 5s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
  }
}
```

### Caching Strategy

```typescript
// Multi-layer caching
export const cacheStrategy = {
  // 1. Browser cache (long-term static assets)
  static: {
    'Cache-Control': 'public, max-age=31536000, immutable'
  },

  // 2. CDN cache (short-term dynamic content)
  cdn: {
    'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300'
  },

  // 3. Server cache (Redis/Memcached)
  server: async (key: string, fn: () => Promise<any>) => {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);

    const result = await fn();
    await redis.set(key, JSON.stringify(result), 'EX', 300);
    return result;
  },

  // 4. In-memory cache (application-level)
  memory: new Map<string, { data: any; expires: number }>()
};
```

## Health Checks

Monitor application health.

### Health Check Endpoints

```typescript
// server.ts
import express from 'express';

const app = express();

// Liveness probe - is the app running?
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Readiness probe - is the app ready to serve traffic?
app.get('/ready', async (req, res) => {
  try {
    // Check database connection
    await db.ping();

    // Check Redis connection
    await redis.ping();

    // Check external dependencies
    await checkExternalServices();

    res.status(200).json({
      status: 'ready',
      checks: {
        database: 'ok',
        redis: 'ok',
        external: 'ok'
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'not ready',
      error: error.message
    });
  }
});

// Startup probe - has the app finished starting?
app.get('/startup', (req, res) => {
  if (appInitialized) {
    res.status(200).json({ status: 'started' });
  } else {
    res.status(503).json({ status: 'starting' });
  }
});

// Metrics endpoint
app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send(`
# HELP http_requests_total Total number of HTTP requests
# TYPE http_requests_total counter
http_requests_total ${metrics.requests}

# HELP http_request_duration_seconds HTTP request duration
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{le="0.1"} ${metrics.duration.p50}
http_request_duration_seconds_bucket{le="0.5"} ${metrics.duration.p90}
http_request_duration_seconds_bucket{le="1"} ${metrics.duration.p95}
  `);
});
```

## Performance Optimization

Optimize for production.

### Compression

```typescript
// Enable gzip/brotli compression
import compression from 'compression';
import shrinkRay from 'shrink-ray-current';

// Gzip
app.use(compression());

// Or Brotli (better compression)
app.use(shrinkRay());
```

### CDN Configuration

```typescript
// Cloudflare CDN rules
const cdnRules = {
  // Cache static assets aggressively
  '/assets/*': {
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Cloudflare-CDN-Cache-Control': 'max-age=31536000'
  },

  // Cache HTML with revalidation
  '/*.html': {
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Cloudflare-CDN-Cache-Control': 'max-age=3600, stale-while-revalidate=86400'
  },

  // Bypass cache for API
  '/api/*': {
    'Cache-Control': 'no-store, no-cache, must-revalidate'
  }
};
```

### Asset Optimization

```typescript
// nexus.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // Optimize chunk splitting
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            // Vendor chunks by package
            if (id.includes('solid-js')) return 'vendor-solid';
            if (id.includes('chart')) return 'vendor-chart';
            return 'vendor';
          }
          // Route-based chunks
          if (id.includes('src/routes/')) {
            const route = id.split('src/routes/')[1].split('/')[0];
            return `route-${route}`;
          }
        },

        // Optimize asset filenames
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'chunks/[name]-[hash].js',
        entryFileNames: '[name]-[hash].js'
      }
    }
  },

  // Image optimization
  plugins: [
    imageOptimizer({
      formats: ['avif', 'webp', 'jpg'],
      quality: 80,
      responsive: {
        sizes: [640, 768, 1024, 1280, 1536]
      }
    })
  ]
});
```

## Security

Secure your deployment.

### Security Headers

```typescript
// server.ts
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://api.example.com'],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  frameguard: {
    action: 'deny'
  },
  noSniff: true,
  xssFilter: true
}));
```

### HTTPS

```typescript
// Force HTTPS
app.use((req, res, next) => {
  if (req.header('x-forwarded-proto') !== 'https') {
    return res.redirect(`https://${req.header('host')}${req.url}`);
  }
  next();
});
```

### Rate Limiting

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP'
});

app.use('/api/', limiter);
```

## Monitoring

Monitor production applications.

### Application Monitoring

```typescript
// server.ts
import * as Sentry from '@sentry/node';
import { ProfilingIntegration } from '@sentry/profiling-node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  integrations: [
    new ProfilingIntegration()
  ],
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0
});

// Error tracking
app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.errorHandler());
```

### Performance Monitoring

```typescript
// Track Web Vitals
import { onCLS, onFID, onFCP, onLCP, onTTFB } from 'web-vitals';

function sendToAnalytics(metric) {
  fetch('/api/analytics', {
    method: 'POST',
    body: JSON.stringify(metric)
  });
}

onCLS(sendToAnalytics);
onFID(sendToAnalytics);
onFCP(sendToAnalytics);
onLCP(sendToAnalytics);
onTTFB(sendToAnalytics);
```

## Titan Backend Deployment

Deploy Titan backend alongside Nexus frontend.

### Monorepo Structure

```typescript
/**
 * Project structure:
 * project/
 * ├── apps/
 * │   ├── frontend/    # Nexus app
 * │   └── backend/     # Titan app
 * ├── packages/
 * │   └── shared/      # Shared types
 * └── docker-compose.yml
 */
```

### Docker Compose (Frontend + Backend)

```yaml
# docker-compose.yml
version: '3.8'

services:
  # Titan backend
  backend:
    build:
      context: ./apps/backend
      dockerfile: Dockerfile
    ports:
      - '4000:4000'
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
    depends_on:
      - postgres
      - redis
    networks:
      - app-network

  # Nexus frontend
  frontend:
    build:
      context: ./apps/frontend
      dockerfile: Dockerfile
    ports:
      - '3000:3000'
    environment:
      - NODE_ENV=production
      - VITE_API_URL=http://backend:4000
    depends_on:
      - backend
    networks:
      - app-network

  # PostgreSQL
  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=myapp
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    networks:
      - app-network

  # Redis
  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    networks:
      - app-network

  # Nginx reverse proxy
  nginx:
    image: nginx:alpine
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - frontend
      - backend
    networks:
      - app-network

volumes:
  postgres-data:
  redis-data:

networks:
  app-network:
    driver: bridge
```

### Nginx Configuration

```nginx
# nginx.conf
upstream frontend {
  server frontend:3000;
}

upstream backend {
  server backend:4000;
}

server {
  listen 80;
  server_name example.com;

  # Redirect to HTTPS
  return 301 https://$server_name$request_uri;
}

server {
  listen 443 ssl http2;
  server_name example.com;

  ssl_certificate /etc/nginx/ssl/cert.pem;
  ssl_certificate_key /etc/nginx/ssl/key.pem;

  # Frontend
  location / {
    proxy_pass http://frontend;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # Backend API
  location /api/ {
    proxy_pass http://backend/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # WebSocket support (for Netron)
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }

  # Static assets with long cache
  location ~* \.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$ {
    proxy_pass http://frontend;
    expires 1y;
    add_header Cache-Control "public, immutable";
  }
}
```

## Examples

### Complete Vercel Deployment

```bash
# Install Vercel CLI
npm install -g vercel

# Login
vercel login

# Deploy
vercel --prod

# Environment variables
vercel env add DATABASE_URL production
vercel env add SECRET_KEY production
```

### Complete AWS Deployment

```typescript
// AWS CDK stack
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

export class NexusStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string) {
    super(scope, id);

    // VPC
    const vpc = new ec2.Vpc(this, 'NexusVPC', {
      maxAzs: 2
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'NexusCluster', {
      vpc
    });

    // Fargate Task Definition
    const taskDef = new ecs.FargateTaskDefinition(this, 'NexusTask', {
      memoryLimitMiB: 512,
      cpu: 256
    });

    taskDef.addContainer('NexusContainer', {
      image: ecs.ContainerImage.fromRegistry('myregistry/nexus-app:latest'),
      portMappings: [{ containerPort: 3000 }],
      environment: {
        NODE_ENV: 'production'
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'nexus' })
    });

    // Fargate Service
    const service = new ecs.FargateService(this, 'NexusService', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 2
    });

    // Load Balancer
    const lb = new elbv2.ApplicationLoadBalancer(this, 'NexusLB', {
      vpc,
      internetFacing: true
    });

    const listener = lb.addListener('Listener', {
      port: 80
    });

    listener.addTargets('NexusTarget', {
      port: 3000,
      targets: [service],
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30)
      }
    });
  }
}
```

## Summary

Nexus provides flexible deployment options:

1. **Static Hosting**: SSG to CDN (Netlify, Vercel, Cloudflare Pages)
2. **Server Deployment**: SSR on Node.js (VPS, Railway, DigitalOcean)
3. **Serverless**: Functions for dynamic routes (Vercel, Netlify, AWS Lambda)
4. **Edge**: SSR at the edge (Cloudflare Workers, Vercel Edge)
5. **Containers**: Docker + Kubernetes for enterprise scale
6. **CI/CD**: Automated testing and deployment
7. **Monitoring**: Health checks, metrics, error tracking
8. **Security**: HTTPS, headers, rate limiting
9. **Performance**: Compression, CDN, caching
10. **Titan Integration**: Full-stack deployment with shared infrastructure

Choose the deployment strategy that fits your needs and scale.
