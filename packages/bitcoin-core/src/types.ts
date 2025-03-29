/**
 * Configuration Types
 */

/**
 * Bitcoin Core RPC configuration options
 */
export interface BitcoinCoreConfig {
  /** RPC server URL */
  url: string;
  /** Network type (mainnet, testnet, regtest) */
  network: string;
  /** RPC username */
  username: string;
  /** RPC password */
  password: string;
  /** Request timeout in milliseconds */
  timeout: number;
  /** Wallet name */
  wallet?: string;
}

/**
 * Create wallet options
 */
export interface CreateWalletOptions {
  /** Name of the wallet */
  wallet_name: string;
  /** Disable private keys for this wallet */
  disable_private_keys?: boolean;
  /** Create a blank wallet */
  blank?: boolean;
  /** Encrypt the wallet with this passphrase */
  passphrase?: string;
  /** Keep track of coin reuse */
  avoid_reuse?: boolean;
  /** Create a native descriptor wallet */
  descriptors?: boolean;
  /** Load wallet on startup */
  load_on_startup?: boolean;
  /** Use an external signer */
  external_signer?: boolean;
}

/**
 * Transaction Types
 */

/**
 * Transaction input details
 */
export interface TransactionInput {
  /** Transaction ID */
  txid: string;
  /** Output index */
  vout: number;
  /** Sequence number */
  sequence?: number;
  /** Witness data */
  witness?: string[];
  /** Script signature */
  scriptSig?: {
    /** Assembly representation */
    asm: string;
    /** Hexadecimal representation */
    hex: string;
  };
}

/**
 * Transaction output details
 */
export interface TransactionOutput {
  /** Amount in BTC */
  value: number;
  /** Output index */
  n: number;
  /** Script public key */
  scriptPubKey: {
    /** Assembly representation */
    asm: string;
    /** Hexadecimal representation */
    hex: string;
    /** Required signatures */
    reqSigs?: number;
    /** Script type */
    type: string;
    /** Associated addresses */
    addresses?: string[];
  };
}

/**
 * Complete transaction information
 */
export interface Transaction {
  /** Transaction ID */
  txid: string;
  /** Transaction hash */
  hash: string;
  /** Version number */
  version: number;
  /** Size in bytes */
  size: number;
  /** Virtual size */
  vsize: number;
  /** Weight units */
  weight: number;
  /** Locktime */
  locktime: number;
  /** Input transactions */
  vin: TransactionInput[];
  /** Output transactions */
  vout: TransactionOutput[];
  /** Hash of the block containing this transaction */
  blockhash?: string;
  /** Number of confirmations */
  confirmations?: number;
  /** Block time */
  blocktime?: number;
  /** Transaction time */
  time?: number;
}

/**
 * Block Types
 */

/**
 * Block header information
 */
export interface BlockHeader {
  /** Block hash */
  hash: string;
  /** Number of confirmations */
  confirmations: number;
  /** Block height */
  height: number;
  /** Version */
  version: number;
  /** Version in hexadecimal */
  versionHex: string;
  /** Merkle root hash */
  merkleroot: string;
  /** Block time */
  time: number;
  /** Median time past */
  mediantime: number;
  /** Nonce value */
  nonce: number;
  /** Bits (target) */
  bits: string;
  /** Mining difficulty */
  difficulty: number;
  /** Total chain work */
  chainwork: string;
  /** Number of transactions */
  nTx: number;
  /** Previous block hash */
  previousblockhash?: string;
  /** Next block hash */
  nextblockhash?: string;
}

/**
 * Network Types
 */

/**
 * Network information
 */
export interface NetworkInfo {
  /** Client version */
  version: number;
  /** Client subversion */
  subversion: string;
  /** Protocol version */
  protocolversion: number;
  /** Local services */
  localservices: string;
  /** Local relay */
  localrelay: boolean;
  /** Time offset */
  timeoffset: number;
  /** Number of connections */
  connections: number;
  /** Network active status */
  networkactive: boolean;
  /** Network list */
  networks: Network[];
  /** Minimum relay fee */
  relayfee: number;
  /** Minimum incremental fee */
  incrementalfee: number;
}

/**
 * Individual network details
 */
export interface Network {
  /** Network name */
  name: string;
  /** Limited status */
  limited: boolean;
  /** Reachable status */
  reachable: boolean;
  /** Proxy settings */
  proxy: string;
  /** Proxy credential randomization */
  proxy_randomize_credentials: boolean;
}

/**
 * RPC Types
 */

/**
 * RPC method parameters
 */
export type RPCParams = (string | number | boolean | object)[];

/**
 * RPC response structure
 */
export interface RPCResponse<T = any> {
  /** Response result */
  result: T;
  /** Error information */
  error: null | {
    /** Error code */
    code: number;
    /** Error message */
    message: string;
  };
  /** Request identifier */
  id: string | number;
}

/**
 * Enums
 */

/**
 * RPC error codes
 */
export enum RPCErrorCode {
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,
  PARSE_ERROR = -32700,
}

/**
 * Bitcoin address types
 */
export type BitcoinAddressType = 'legacy' | 'p2sh-segwit' | 'bech32' | 'bech32m';

/**
 * Fee estimation modes
 */
export type EstimateMode = 'unset' | 'economical' | 'conservative';

/**
 * Signature hash types
 */
export type SignatureHashType =
  | 'DEFAULT'
  | 'ALL'
  | 'NONE'
  | 'SINGLE'
  | 'ALL|ANYONECANPAY'
  | 'NONE|ANYONECANPAY'
  | 'SINGLE|ANYONECANPAY';

/**
 * Method Parameter Types
 */

/**
 * Parameters for creating a raw transaction
 */
export interface CreateRawTransactionParams {
  /** Transaction inputs */
  inputs: TransactionInput[];
  /** Transaction outputs */
  outputs: TransactionOutput[];
  /** Locktime */
  locktime?: number;
  /** Replace by fee */
  replaceable?: boolean;
}

/**
 * Parameters for sending to an address
 */
export interface SendToAddressParams {
  /** Destination address */
  address: string;
  /** Amount to send */
  amount: number | string;
  /** Transaction comment */
  comment?: string;
  /** Comment for recipient */
  comment_to?: string;
  /** Subtract fee from amount */
  subtractfeefromamount?: boolean;
  /** Allow replacement */
  replaceable?: boolean;
  /** Confirmation target */
  conf_target?: number;
  /** Fee estimate mode */
  estimate_mode?: EstimateMode;
  /** Avoid address reuse */
  avoid_reuse?: boolean;
  /** Fee rate */
  fee_rate?: number | string;
  /** Verbose output */
  verbose?: boolean;
}

/**
 * Parameters for sending multiple transactions to multiple addresses.
 */
export interface SendManyParams {
  /** Dummy parameter for backward compatibility */
  dummy?: string;
  /** The amounts to send */
  amounts: any;
  /** Minimum number of confirmations */
  minconf?: number;
  /** Comment for the transaction */
  comment?: string;
  /** Subtract fee from these outputs */
  subtractfeefrom?: any[];
  /** Allow transaction replacement */
  replaceable?: boolean;
  /** Confirmation target */
  conf_target?: number;
  /** Fee estimation mode */
  estimate_mode?: EstimateMode;
  /** Fee rate to use */
  fee_rate?: number | string;
  /** Verbose output */
  verbose?: boolean;
}

/**
 * Parameters for wallet operations
 */
export interface WalletOperationParams {
  /** Minimum confirmations */
  minconf?: number;
  /** Include watch-only addresses */
  include_watchonly?: boolean;
  /** Include immature coinbase */
  include_immature_coinbase?: boolean;
  /** Avoid address reuse */
  avoid_reuse?: boolean;
}

/**
 * Cache Types
 */

/**
 * Cache entry structure
 */
export interface CacheEntry<T> {
  /** Cached value */
  value: T;
  /** Timestamp of cache entry */
  timestamp: number;
  /** Time to live in milliseconds */
  ttl: number;
}

/**
 * Batch Types
 */

/**
 * Batch request structure
 */
export interface BatchRequest {
  /** Method name */
  method: string;
  /** Method parameters */
  params?: Record<string, any>;
  /** Request options */
  options?: {
    /** Wallet name */
    wallet?: string;
  };
}