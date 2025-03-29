# @devgrid/bitcoin-core

A strongly-typed Bitcoin Core RPC client for Node.js with full TypeScript support.

## Features

- 🚀 Full TypeScript support with comprehensive type definitions
- 💪 Strong type checking for all RPC methods and responses
- 🔒 Secure connection handling with SSL/TLS support
- ⚡ Promise-based API
- 🔄 Automatic request batching
- 🎯 Detailed error handling
- 📝 Extensive documentation

## Installation

```bash
npm install @devgrid/bitcoin-core
# or
yarn add @devgrid/bitcoin-core
```

## Quick Start

```typescript
import { BitcoinCore } from '@devgrid/bitcoin-core';

const client = new BitcoinCore({
  host: 'localhost',
  port: 8332,
  username: 'your-username',
  password: 'your-password',
  ssl: true
});

// Get blockchain info
const info = await client.getBlockchainInfo();
console.log(info);

// Get transaction by ID
const tx = await client.getTransaction('txid');
console.log(tx);
```

## API Documentation

### Configuration

```typescript
interface BitcoinConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  ssl?: boolean;
  timeout?: number;
  headers?: Record<string, string>;
}
```

### Core Methods

#### Blockchain

- `getBlockchainInfo()`: Get blockchain info
- `getBlock(hash: string)`: Get block by hash
- `getBlockHash(height: number)`: Get block hash by height
- `getBlockCount()`: Get current block count

#### Transactions

- `getTransaction(txid: string)`: Get transaction details
- `sendTransaction(hex: string)`: Send raw transaction
- `decodeTransaction(hex: string)`: Decode raw transaction

#### Wallet

- `getBalance()`: Get wallet balance
- `listUnspent()`: List unspent transactions
- `sendToAddress(address: string, amount: number)`: Send to address

### Error Handling

```typescript
try {
  await client.getTransaction('invalid-txid');
} catch (error) {
  if (error.code === RPCErrorCode.INVALID_PARAMS) {
    console.error('Invalid transaction ID');
  }
}
```

### Batch Requests

```typescript
const batch = client.batch();
batch.getBlockCount();
batch.getBlockchainInfo();
const [count, info] = await batch.execute();
```

## Advanced Usage

### Custom Headers

```typescript
const client = new BitcoinCore({
  // ... other config
  headers: {
    'User-Agent': 'MyApp/1.0.0'
  }
});
```

### SSL/TLS Configuration

```typescript
const client = new BitcoinCore({
  // ... other config
  ssl: true,
  sslOptions: {
    ca: fs.readFileSync('ca.pem'),
    cert: fs.readFileSync('cert.pem'),
    key: fs.readFileSync('key.pem')
  }
});
```

### Timeout Configuration

```typescript
const client = new BitcoinCore({
  // ... other config
  timeout: 30000 // 30 seconds
});
```

## Error Codes

| Code | Description |
|------|-------------|
| -32600 | Invalid Request |
| -32601 | Method not found |
| -32602 | Invalid params |
| -32603 | Internal error |
| -32700 | Parse error |

## Contributing

Contributions are welcome! Please read our [contributing guidelines](CONTRIBUTING.md) first.

## Testing

```bash
npm test
# or
yarn test
```

## License

MIT

## Credits

Built with TypeScript and Node.js.
