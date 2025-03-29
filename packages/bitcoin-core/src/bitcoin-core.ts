import axios from 'axios';

import type { EstimateMode, SendManyParams, BitcoinCoreConfig, SignatureHashType, BitcoinAddressType, CreateWalletOptions, SendToAddressParams } from './types';

/**
 * BitcoinCore class provides methods to interact with Bitcoin Core RPC.
 */
export class BitcoinCore {
  private config: BitcoinCoreConfig;
  private url: string;
  private cache: Map<string, any>;
  private pendingRequests: Array<{ method: string; params?: Record<string, any>; options?: { wallet?: string } }>;

  /**
   * Constructor for BitcoinCore class.
   * @param config - Configuration object for Bitcoin Core.
   */
  constructor(config: BitcoinCoreConfig) {
    this.config = config;
    this.url = this.config.url;
    this.cache = new Map();
    this.pendingRequests = [];
  }

  // blockchain rpc methods

  /**
   * Get the best block hash.
   * @returns Promise resolving to the best block hash.
   */
  public async getBestBlockhash(): Promise<string> {
    return this.callMethod('getbestblockhash');
  }

  /**
   * Get block information.
   * @param params - Parameters including blockhash and verbosity.
   * @returns Promise resolving to block information or block data as string.
   */
  public async getBlock(params: { blockhash: string; verbosity?: number }): Promise<{ [key: string]: any } | string> {
    return this.callMethod('getblock', params);
  }

  /**
   * Get blockchain information.
   * @returns Promise resolving to blockchain information.
   */
  public async getBlockchainInfo(): Promise<any> {
    return this.callMethod('getblockchaininfo');
  }

  /**
   * Get the block count.
   * @returns Promise resolving to the block count.
   */
  public async getBlockCount(): Promise<number> {
    return this.callMethod('getblockcount');
  }

  /**
   * Get block filter.
   * @param params - Parameters including blockhash and filtertype.
   * @returns Promise resolving to block filter information.
   */
  public async getBlockFilter(params: { blockhash: string; filtertype?: string }): Promise<any> {
    return this.callMethod('getblockfilter', params);
  }

  /**
   * Get block hash by height.
   * @param params - Parameters including height.
   * @returns Promise resolving to the block hash.
   */
  public async getBlockHash(params: { height: number }): Promise<string> {
    return this.callMethod('getblockhash', params);
  }

  /**
   * Get block header.
   * @param params - Parameters including blockhash and verbosity.
   * @returns Promise resolving to block header information.
   */
  public async getBlockHeader(params: { blockhash: string; verbose?: boolean }): Promise<any> {
    return this.callMethod('getblockheader', params);
  }

  /**
   * Get block statistics.
   * @param params - Parameters including hash_or_height and stats.
   * @returns Promise resolving to block statistics.
   */
  public async getBlockStats(params: { hash_or_height: string | number; stats?: string[] }): Promise<any> {
    return this.callMethod('getblockstats', params);
  }

  /**
   * Get chain tips.
   * @returns Promise resolving to chain tips information.
   */
  public async getChainTips(): Promise<any> {
    return this.callMethod('getchaintips');
  }

  /**
   * Get chain transaction statistics.
   * @param params - Parameters including nblocks and blockhash.
   * @returns Promise resolving to chain transaction statistics.
   */
  public async getChainTxStats(params: { nblocks?: number; blockhash?: string }): Promise<any> {
    return this.callMethod('getchaintxstats', params);
  }

  /**
   * Get difficulty.
   * @returns Promise resolving to the difficulty.
   */
  public async getDifficulty(): Promise<number> {
    return this.callMethod('getdifficulty');
  }

  /**
   * Get mempool ancestors.
   * @param params - Parameters including txid and verbosity.
   * @returns Promise resolving to mempool ancestors information.
   */
  public async getMempoolAncestors(params: { txid: string; verbose?: boolean }): Promise<any> {
    return this.callMethod('getmempoolancestors', params);
  }

  /**
   * Get mempool descendants.
   * @param params - Parameters including txid and verbosity.
   * @returns Promise resolving to mempool descendants information.
   */
  public async getMempoolDescendants(params: { txid: string; verbose?: boolean }): Promise<any> {
    return this.callMethod('getmempooldescendants', params);
  }

  /**
   * Get mempool entry.
   * @param params - Parameters including txid.
   * @returns Promise resolving to mempool entry information.
   */
  public async getMempoolEntry(params: { txid: string }): Promise<any> {
    return this.callMethod('getmempoolentry', params);
  }

  /**
   * Get mempool information.
   * @returns Promise resolving to mempool information.
   */
  public async getMempoolInfo(): Promise<any> {
    return this.callMethod('getmempoolinfo');
  }

  /**
   * Get raw mempool.
   * @param params - Parameters including verbosity and mempool_sequence.
   * @returns Promise resolving to raw mempool information.
   */
  public async getRawMempool(params: { verbose?: boolean; mempool_sequence?: boolean }): Promise<any> {
    return this.callMethod('getrawmempool', params);
  }

  /**
   * Get transaction output.
   * @param params - Parameters including txid, n, and include_mempool.
   * @returns Promise resolving to transaction output information.
   */
  public async getTxOut(params: { txid: string; n: number; include_mempool?: boolean }): Promise<any> {
    return this.callMethod('gettxout', params);
  }

  /**
   * Get transaction output proof.
   * @param params - Parameters including txids and blockhash.
   * @returns Promise resolving to transaction output proof.
   */
  public async getTxOutProof(params: { txids: string[]; blockhash?: string }): Promise<any> {
    return this.callMethod('gettxoutproof', params);
  }

  /**
   * Get transaction output set information.
   * @param params - Parameters including hash_type, hash_or_height, and use_index.
   * @returns Promise resolving to transaction output set information.
   */
  public async getTxOutSetInfo(params: {
    hash_type?: string;
    hash_or_height?: string | number;
    use_index?: boolean;
  }): Promise<any> {
    return this.callMethod('gettxoutsetinfo', params);
  }

  /**
   * Mark a block as precious.
   * @param params - Parameters including blockhash.
   * @returns Promise resolving to the result of marking the block as precious.
   */
  public async preciousBlock(params: { blockhash: string }): Promise<any> {
    return this.callMethod('preciousblock', params);
  }

  /**
   * Prune the blockchain.
   * @param params - Parameters including height.
   * @returns Promise resolving to the result of pruning the blockchain.
   */
  public async pruneBlockChain(params: { height: number }): Promise<any> {
    return this.callMethod('pruneblockchain', params);
  }

  /**
   * Save the mempool.
   * @returns Promise resolving to the result of saving the mempool.
   */
  public async saveMempool(): Promise<any> {
    return this.callMethod('savemempool');
  }

  /**
   * Scan the transaction output set.
   * @param params - Parameters including action and scanobjects.
   * @returns Promise resolving to the result of scanning the transaction output set.
   */
  public async scanTxOutSet(params: { action: 'start' | 'abort' | 'status'; scanobjects?: any[] }): Promise<any> {
    return this.callMethod('scantxoutset', params);
  }

  /**
   * Verify the blockchain.
   * @param params - Parameters including checklevel and nblocks.
   * @returns Promise resolving to the result of verifying the blockchain.
   */
  public async verifyChain(params: { checklevel?: 0 | 1 | 2 | 3 | 4; nblocks?: number }): Promise<any> {
    return this.callMethod('verifychain', params);
  }

  /**
   * Verify the transaction output proof.
   * @param params - Parameters including proof.
   * @returns Promise resolving to the result of verifying the transaction output proof.
   */
  public async verifyTxOutProof(params: { proof: string }): Promise<any> {
    return this.callMethod('verifytxoutproof', params);
  }

  // control rpc methods

  /**
   * Get memory information.
   * @param params - Parameters including mode.
   * @returns Promise resolving to memory information.
   */
  public async getMemoryInfo(params: { mode?: 'stats' | 'mallocinfo' }): Promise<any> {
    return this.callMethod('getmemoryinfo', params);
  }

  /**
   * Get RPC information.
   * @returns Promise resolving to RPC information.
   */
  public async getRpcInfo(): Promise<any> {
    return this.callMethod('getrpcinfo');
  }

  /**
   * Get help information.
   * @param params - Parameters including command.
   * @returns Promise resolving to help information.
   */
  public async help(params: { command?: string }): Promise<any> {
    return this.callMethod('help', params);
  }

  /**
   * Get logging information.
   * @param params - Parameters including include and exclude.
   * @returns Promise resolving to logging information.
   */
  public async logging(params: { include?: string[]; exclude?: string[] }): Promise<any> {
    return this.callMethod('logging', params);
  }

  /**
   * Stop the Bitcoin Core server.
   * @returns Promise resolving to the result of stopping the server.
   */
  public async stop(): Promise<any> {
    return this.callMethod('stop');
  }

  /**
   * Get the uptime of the Bitcoin Core server.
   * @returns Promise resolving to the uptime in seconds.
   */
  public async uptime(): Promise<number> {
    return this.callMethod('uptime');
  }

  // generating rpc methods

  /**
   * Generate a block.
   * @param params - Parameters including output, transactions, and submit.
   * @returns Promise resolving to the generated block.
   */
  public async generateBlock(params: { output: string; transactions: string[]; submit?: boolean }): Promise<string[]> {
    return this.callMethod('generateblock', params);
  }

  /**
   * Generate blocks to an address.
   * @param params - Parameters including nblocks, address, and maxtries.
   * @returns Promise resolving to the generated blocks.
   */
  public async generateToAddress(params: { nblocks: number; address: string; maxtries?: number }): Promise<string[]> {
    return this.callMethod('generatetoaddress', params);
  }

  /**
   * Generate blocks to a descriptor.
   * @param params - Parameters including num_blocks, descriptor, and maxtries.
   * @returns Promise resolving to the generated blocks.
   */
  public async generateToDescriptor(params: {
    num_blocks: number;
    descriptor: string;
    maxtries?: number;
  }): Promise<string[]> {
    return this.callMethod('generatetodescriptor', params);
  }

  // mining rpc methods

  /**
   * Get block template.
   * @param params - Parameters including template_request.
   * @returns Promise resolving to the block template.
   */
  public async getBlockTemplate(params: { template_request: Record<string, any> }): Promise<any> {
    return this.callMethod('getblocktemplate', params);
  }

  /**
   * Get mining information.
   * @returns Promise resolving to mining information.
   */
  public async getMiningInfo(): Promise<any> {
    return this.callMethod('getmininginfo');
  }

  /**
   * Get network hash rate.
   * @param params - Parameters including nblocks and height.
   * @returns Promise resolving to the network hash rate.
   */
  public async getNetworkHashPs(params: { nblocks?: number; height?: number }): Promise<number> {
    return this.callMethod('getnetworkhashps', params);
  }

  /**
   * Prioritize a transaction.
   * @param params - Parameters including txid and fee_delta.
   * @returns Promise resolving to the result of prioritizing the transaction.
   */
  public async prioritizeTransaction(params: { txid: string; fee_delta: number }): Promise<any> {
    return this.callMethod('prioritisetransaction', params);
  }

  /**
   * Submit a block.
   * @param params - Parameters including hexdata and dummy.
   * @returns Promise resolving to the result of submitting the block.
   */
  public async submitBlock(params: { hexdata: string; dummy?: string }): Promise<string | null> {
    return this.callMethod('submitblock', params);
  }

  /**
   * Submit a header.
   * @param params - Parameters including hexdata.
   * @returns Promise resolving to the result of submitting the header.
   */
  public async submitHeader(params: { hexdata: string }): Promise<any> {
    return this.callMethod('submitheader', params);
  }

  // network rpc methods

  /**
   * Add a node to the network.
   * @param params - Parameters including node, command, and v2transport.
   * @returns Promise resolving to the result of adding the node.
   */
  public async addNode(params: {
    node: string;
    command: 'add' | 'remove' | 'onetry';
    v2transport?: boolean;
  }): Promise<null> {
    return this.callMethod('addnode', params);
  }

  /**
   * Clear banned nodes.
   * @returns Promise resolving to the result of clearing banned nodes.
   */
  public async clearBanned(): Promise<null> {
    return this.callMethod('clearbanned');
  }

  /**
   * Disconnect a node.
   * @param params - Parameters including address and nodeid.
   * @returns Promise resolving to the result of disconnecting the node.
   */
  public async disconnectNode(params: { address?: string; nodeid?: number }): Promise<null> {
    return this.callMethod('disconnectnode', params);
  }

  /**
   * Get added node information.
   * @param params - Parameters including node.
   * @returns Promise resolving to added node information.
   */
  public async getAddedNodeInfo(params: { node?: string }): Promise<any> {
    return this.callMethod('getaddednodeinfo', params);
  }

  /**
   * Get connection count.
   * @returns Promise resolving to the connection count.
   */
  public async getConnectionCount(): Promise<number> {
    return this.callMethod('getconnectioncount');
  }

  /**
   * Get network totals.
   * @returns Promise resolving to network totals.
   */
  public async getNetTotals(): Promise<any> {
    return this.callMethod('getnettotals');
  }

  /**
   * Get network information.
   * @returns Promise resolving to network information.
   */
  public async getNetworkInfo(): Promise<any> {
    return this.callMethod('getnetworkinfo');
  }

  /**
   * Get node addresses.
   * @param params - Parameters including count and network.
   * @returns Promise resolving to node addresses.
   */
  public async getNodeAddresses(params: {
    count?: number;
    network?: 'ipv4' | 'ipv6' | 'onion' | 'i2p' | 'cjdns';
  }): Promise<any> {
    return this.callMethod('getnodeaddresses', params);
  }

  /**
   * Get peer information.
   * @returns Promise resolving to peer information.
   */
  public async getPeerInfo(): Promise<any> {
    return this.callMethod('getpeerinfo');
  }

  /**
   * List banned nodes.
   * @returns Promise resolving to the list of banned nodes.
   */
  public async listBanned(): Promise<any> {
    return this.callMethod('listbanned');
  }

  /**
   * Ping the network.
   * @returns Promise resolving to the result of the ping.
   */
  public async ping(): Promise<any> {
    return this.callMethod('ping');
  }

  /**
   * Set a ban on a subnet.
   * @param params - Parameters including subnet, command, bantime, and absolute.
   * @returns Promise resolving to the result of setting the ban.
   */
  public async setBan(params: {
    subnet: string;
    command: 'add' | 'remove';
    bantime?: number;
    absolute?: boolean;
  }): Promise<null> {
    return this.callMethod('setban', params);
  }

  /**
   * Set network active state.
   * @param params - Parameters including state.
   * @returns Promise resolving to the result of setting the network active state.
   */
  public async setNetworkActive(params: { state: boolean }): Promise<boolean> {
    return this.callMethod('setnetworkactive', params);
  }

  // raw transaction rpc methods

  /**
   * Analyze partially signed Bitcoin transaction (PSBT).
   * @param params - Parameters including psbt.
   * @returns Promise resolving to the result of analyzing the PSBT.
   */
  public async analyzePsbt(params: { psbt: string }): Promise<any> {
    return this.callMethod('analyzepsbt', params);
  }

  /**
   * Combine multiple PSBTs.
   * @param params - Parameters including txs.
   * @returns Promise resolving to the result of combining the PSBTs.
   */
  public async combinePsbt(params: { txs: string[] }): Promise<any> {
    return this.callMethod('combinepsbt', params);
  }

  /**
   * Combine multiple raw transactions.
   * @param params - Parameters including txs.
   * @returns Promise resolving to the result of combining the raw transactions.
   */
  public async combineRawTransaction(params: { txs: string[] }): Promise<string> {
    return this.callMethod('combinerawtransaction', params);
  }

  /**
   * Convert a raw transaction to a PSBT.
   * @param params - Parameters including hexstring, permitsigdata, and iswitness.
   * @returns Promise resolving to the result of converting the raw transaction to a PSBT.
   */
  public async convertToPsbt(params: {
    hexstring: string;
    permitsigdata?: boolean;
    iswitness?: boolean;
  }): Promise<any> {
    return this.callMethod('converttopsbt', params);
  }

  /**
   * Create a PSBT.
   * @param params - Parameters including inputs, outputs, locktime, and replaceable.
   * @returns Promise resolving to the created PSBT.
   */
  public async createPsbt(params: {
    inputs: any[];
    outputs: any[];
    locktime?: number;
    replaceable?: boolean;
  }): Promise<string> {
    return this.callMethod('createpsbt', params);
  }

  /**
   * Create a raw transaction.
   * @param params - Parameters including inputs, outputs, locktime, and replaceable.
   * @returns Promise resolving to the created raw transaction.
   */
  public async createRawTransaction(params: {
    inputs: any[];
    outputs: any[];
    locktime?: number;
    replaceable?: boolean;
  }): Promise<string> {
    return this.callMethod('createrawtransaction', params);
  }

  // decodepsbt
  public async decodePsbt(params: { psbt: string }): Promise<any> {
    return this.callMethod('decodepsbt', params);
  }

  /**
   * Decode a raw transaction.
   * @param params - Parameters including hexstring and optional iswitness flag.
   * @returns Promise resolving to the decoded transaction details.
   */
  public async decodeRawTransaction(params: { hexstring: string; iswitness?: boolean }): Promise<any> {
    return this.callMethod('decoderawtransaction', params);
  }

  /**
   * Decode a script.
   * @param params - Parameters including hexstring.
   * @returns Promise resolving to the decoded script details.
   */
  public async decodeScript(params: { hexstring: string }): Promise<any> {
    return this.callMethod('decodescript', params);
  }

  /**
   * Finalize a PSBT (Partially Signed Bitcoin Transaction).
   * @param params - Parameters including psbt and optional extract flag.
   * @returns Promise resolving to the finalized PSBT details.
   */
  public async finalizePsbt(params: { psbt: string; extract?: boolean }): Promise<any> {
    return this.callMethod('finalizepsbt', params);
  }

  /**
   * Fund a raw transaction.
   * @param params - Parameters including hexstring, optional options, and iswitness flag.
   * @returns Promise resolving to the funded transaction details.
   */
  public async fundRawTransaction(params: { hexstring: string; options?: any; iswitness?: boolean }): Promise<any> {
    return this.callMethod('fundrawtransaction', params);
  }

  /**
   * Get a raw transaction.
   * @param params - Parameters including txid, optional verbosity, and blockhash.
   * @returns Promise resolving to the raw transaction details.
   */
  public async getRawTransaction(params: { txid: string; verbosity?: boolean; blockhash?: string }): Promise<any> {
    return this.callMethod('getrawtransaction', params);
  }

  /**
   * Join multiple PSBTs into one.
   * @param params - Parameters including an array of transaction strings.
   * @returns Promise resolving to the joined PSBT as a string.
   */
  public async joinPsbts(params: { txs: string[] }): Promise<string> {
    return this.callMethod('joinpsbts', params);
  }

  /**
   * Send a raw transaction.
   * @param params - Parameters including hexstring, optional maxfeerate, and maxburnamount.
   * @returns Promise resolving to the transaction ID of the sent transaction.
   */
  public async sendRawTransaction(params: {
    hexstring: string;
    maxfeerate?: number | string;
    maxburnamount?: number | string;
  }): Promise<string> {
    return this.callMethod('sendrawtransaction', params);
  }

  /**
   * Sign a raw transaction with a private key.
   * @param params - Parameters including hexstring, private keys, optional previous transactions, and sighashtype.
   * @returns Promise resolving to the signed transaction details.
   */
  public async signRawTransactionWithKey(params: {
    hexstring: string;
    privkeys: string[];
    prevtxs?: any[];
    sighashtype?: SignatureHashType;
  }): Promise<any> {
    return this.callMethod('signrawtransactionwithkey', params);
  }

  /**
   * Test acceptance of a raw transaction in the mempool.
   * @param params - Parameters including raw transactions and optional maxfeerate.
   * @returns Promise resolving to the acceptance result.
   */
  public async testMempoolAccept(params: { rawtxs: string[]; maxfeerate?: number | string }): Promise<any> {
    return this.callMethod('testmempoolaccept', params);
  }

  /**
   * Update a PSBT with UTXO information.
   * @param params - Parameters including psbt and optional descriptors.
   * @returns Promise resolving to the updated PSBT as a string.
   */
  public async utxoUpdatePsbt(params: { psbt: string; descriptors?: any[] }): Promise<string> {
    return this.callMethod('utxoupdatepsbt', params);
  }

  /**
   * Create a multisig address.
   * @param params - Parameters including the number of required signatures, keys, and optional address type.
   * @returns Promise resolving to the multisig address details.
   */
  public async createMultisig(params: {
    nrequired: number;
    keys: string[];
    address_type?: Omit<BitcoinAddressType, 'bech32m'>;
  }): Promise<any> {
    return this.callMethod('createmultisig', params);
  }

  /**
   * Derive addresses from a descriptor.
   * @param params - Parameters including descriptor and optional range.
   * @returns Promise resolving to an array of derived addresses.
   */
  public async deriveAddresses(params: { descriptor: string; range?: number | number[] }): Promise<string[]> {
    return this.callMethod('deriveaddresses', params);
  }

  /**
   * Estimate the smart fee for a transaction.
   * @param params - Parameters including confirmation target and optional estimate mode.
   * @returns Promise resolving to the estimated fee rate.
   */
  public async estimateSmartFee(params: { conf_target: number; estimate_mode?: EstimateMode }): Promise<any> {
    return this.callMethod('estimatesmartfee', params);
  }

  /**
   * Get information about a descriptor.
   * @param params - Parameters including the descriptor string.
   * @returns Promise resolving to the descriptor information.
   */
  public async getDescriptorInfo(params: { descriptor: string }): Promise<any> {
    return this.callMethod('getdescriptorinfo', params);
  }

  /**
   * Get information about available indices.
   * @param params - Parameters including optional index name.
   * @returns Promise resolving to the index information.
   */
  public async getIndexInfo(params: { index_name?: string }): Promise<any> {
    return this.callMethod('getindexinfo', params);
  }

  /**
   * Sign a message with a private key.
   * @param params - Parameters including the private key and message to sign.
   * @returns Promise resolving to the signature as a string.
   */
  public async signMessageWithPrivKey(params: { privkey: string; message: string }): Promise<string> {
    return this.callMethod('signmessagewithprivkey', params);
  }

  /**
   * Validate a Bitcoin address.
   * @param params - Parameters including the address to validate.
   * @returns Promise resolving to the validation result.
   */
  public async validateAddress(params: { address: string }): Promise<any> {
    return this.callMethod('validateaddress', params);
  }

  /**
   * Verify a signed message.
   * @param params - Parameters including the address, signature, and message.
   * @returns Promise resolving to a boolean indicating if the signature is valid.
   */
  public async verifyMessage(params: { address: string; signature: string; message: string }): Promise<boolean> {
    return this.callMethod('verifymessage', params);
  }

  // Wallet RPC methods

  /**
   * Abandon a transaction.
   * @param params - Parameters including the transaction ID to abandon.
   * @returns Promise resolving when the transaction is abandoned.
   */
  public async abandonTransaction(params: { txid: string }): Promise<void> {
    return this.callMethod('abandontransaction', params);
  }

  /**
   * Abort the current blockchain rescan.
   * @returns Promise resolving when the rescan is aborted.
   */
  public async abortRescan(): Promise<void> {
    return this.callMethod('abortrescan');
  }

  /**
   * Add a multi-signature address to the wallet.
   * @param params - Parameters for adding a multi-signature address.
   * @param params.nrequired - The number of required signatures out of the n keys.
   * @param params.keys - An array of public keys or addresses.
   * @param params.label - (Optional) A label for the address.
   * @param params.address_type - (Optional) The address type, excluding 'bech32m'.
   * @returns Promise resolving to the created multi-signature address as a string.
   */
  public async addMultiSigAddress(params: {
    nrequired: number;
    keys: string[];
    label?: string;
    address_type?: Omit<BitcoinAddressType, 'bech32m'>;
  }): Promise<string> {
    return this.callMethod('addmultisigaddress', params);
  }

  /**
   * Backup the wallet to a specified destination.
   * @param params - Parameters for backing up the wallet.
   * @param params.destination - The destination path for the backup.
   * @returns Promise resolving when the wallet is successfully backed up.
   */
  public async backupWallet(params: { destination: string }): Promise<void> {
    return this.callMethod('backupwallet', params);
  }

  /**
   * Bump the fee of an existing transaction.
   * @param params - Parameters for bumping the transaction fee.
   * @param params.txid - The transaction ID of the transaction to bump.
   * @param params.options - (Optional) Additional options for fee bumping.
   * @returns Promise resolving to the result of the fee bump operation.
   */
  public async bumpFee(params: { txid: string; options?: any }): Promise<any> {
    return this.callMethod('bumpfee', params);
  }

  /**
   * Create a new wallet.
   * @param params - Parameters for creating a new wallet.
   * @returns Promise resolving to the result of the wallet creation.
   */
  public async createWallet(params: CreateWalletOptions): Promise<any> {
    return this.callMethod('createwallet', params);
  }

  /**
   * Dump the private key for a given address.
   * @param params - Parameters for dumping the private key.
   * @param params.address - The Bitcoin address for which to dump the private key.
   * @returns Promise resolving to the private key as a string.
   */
  public async dumpPrivKey(params: { address: string }): Promise<string> {
    return this.callMethod('dumpprivkey', params);
  }

  /**
   * Dump all wallet keys to a file.
   * @param params - Parameters for dumping the wallet.
   * @param params.filename - The filename to which the wallet keys will be dumped.
   * @returns Promise resolving to the result of the wallet dump operation.
   */
  public async dumpWallet(params: { filename: string }): Promise<string> {
    return this.callMethod('dumpwallet', params);
  }

  /**
   * Encrypt the wallet with a passphrase.
   * @param params - Parameters for encrypting the wallet.
   * @param params.passphrase - The passphrase to encrypt the wallet with.
   * @returns Promise resolving when the wallet is successfully encrypted.
   */
  public async encryptWallet(params: { passphrase: string }): Promise<void> {
    return this.callMethod('encryptwallet', params);
  }

  /**
   * Get all addresses associated with a specific label.
   * @param params - Parameters for retrieving addresses by label.
   * @param params.label - The label to search for.
   * @returns Promise resolving to an array of addresses associated with the label.
   */
  public async getAddressesByLabel(params: { label: string }): Promise<string[]> {
    return this.callMethod('getaddressesbylabel', params);
  }

  /**
   * Get detailed information about a specific address.
   * @param params - Parameters for retrieving address information.
   * @param params.address - The Bitcoin address to retrieve information for.
   * @returns Promise resolving to the address information.
   */
  public async getAddressInfo(params: { address: string }): Promise<any> {
    return this.callMethod('getaddressinfo', params);
  }

  /**
   * Get the balance of the wallet.
   * @param params - Parameters for retrieving the wallet balance.
   * @param params.dummy - (Optional) Dummy parameter for backward compatibility.
   * @param params.minconf - (Optional) Minimum number of confirmations for transactions to be included.
   * @param params.include_watchonly - (Optional) Whether to include watch-only addresses.
   * @param params.avoid_reuse - (Optional) Whether to avoid reusing addresses.
   * @returns Promise resolving to the wallet balance as a number.
   */
  public async getBalance(params: {
    dummy?: string;
    minconf?: number;
    include_watchonly?: boolean;
    avoid_reuse?: boolean;
  }): Promise<number> {
    return this.callMethod('getbalance', params);
  }

  /**
   * Retrieve the balances of the wallet.
   * @returns Promise resolving to the wallet balances.
   */
  public async getBalances(): Promise<any> {
    return this.callMethod('getbalances');
  }

  /**
   * Generate a new Bitcoin address for receiving payments.
   * @param params - Parameters for generating a new address.
   * @param params.label - (Optional) Label for the new address.
   * @param params.address_type - (Optional) Type of address to generate.
   * @param options - (Optional) Additional options.
   * @param options.wallet - (Optional) Specify a wallet to use.
   * @returns Promise resolving to the new Bitcoin address as a string.
   */
  public async getNewAddress(
    params: { label?: string; address_type?: BitcoinAddressType },
    options?: { wallet?: string }
  ): Promise<string> {
    return this.callMethod('getnewaddress', params, options);
  }

  /**
   * Get a new change address.
   * @param params - Parameters for generating a change address.
   * @param params.address_type - (Optional) Type of address to generate.
   * @returns Promise resolving to the new change address as a string.
   */
  public async getRawChangeAddress(params: { address_type?: BitcoinAddressType }): Promise<string> {
    return this.callMethod('getrawchangeaddress', params);
  }

  /**
   * Get the total amount received by a specific address.
   * @param params - Parameters for retrieving received amount.
   * @param params.address - The Bitcoin address to check.
   * @param params.minconf - (Optional) Minimum number of confirmations.
   * @param params.include_immature_coinbase - (Optional) Include immature coinbase transactions.
   * @returns Promise resolving to the total amount received as a number.
   */
  public async getReceivedByAddress(params: {
    address: string;
    minconf?: number;
    include_immature_coinbase?: boolean;
  }): Promise<number> {
    return this.callMethod('getreceivedbyaddress', params);
  }

  /**
   * Get the total amount received by a specific label.
   * @param params - Parameters for retrieving received amount by label.
   * @param params.label - The label to check.
   * @param params.minconf - (Optional) Minimum number of confirmations.
   * @param params.include_immature_coinbase - (Optional) Include immature coinbase transactions.
   * @returns Promise resolving to the total amount received as a number.
   */
  public async getReceivedByLabel(params: {
    label: string;
    minconf?: number;
    include_immature_coinbase?: boolean;
  }): Promise<number> {
    return this.callMethod('getreceivedbylabel', params);
  }

  /**
   * Get detailed information about a specific transaction.
   * @param params - Parameters for retrieving transaction details.
   * @param params.txid - The transaction ID to retrieve.
   * @param params.include_watchonly - (Optional) Include watch-only addresses.
   * @param params.verbose - (Optional) Provide verbose transaction details.
   * @returns Promise resolving to the transaction details.
   */
  public async getTransaction(params: { txid: string; include_watchonly?: boolean; verbose?: boolean }): Promise<any> {
    return this.callMethod('gettransaction', params);
  }

  /**
   * Get the total unconfirmed balance of the wallet.
   * @returns Promise resolving to the unconfirmed balance as a number.
   */
  public async getUnconfirmedBalance(): Promise<number> {
    return this.callMethod('getunconfirmedbalance');
  }

  /**
   * Get general information about the wallet.
   * @returns Promise resolving to the wallet information.
   */
  public async getWalletInfo(): Promise<any> {
    return this.callMethod('getwalletinfo');
  }

  /**
   * Import an address to the wallet.
   * @param params - Parameters for importing an address.
   * @param params.address - The address to import.
   * @param params.label - (Optional) Label for the imported address.
   * @param params.rescan - (Optional) Rescan the blockchain for transactions.
   * @param params.p2sh - (Optional) Whether the address is a P2SH address.
   * @returns Promise resolving when the address is successfully imported.
   */
  public async importAddress(params: {
    address: string;
    label?: string;
    rescan?: boolean;
    p2sh?: boolean;
  }): Promise<void> {
    return this.callMethod('importaddress', params);
  }

  /**
   * Import descriptors to the wallet.
   * @param params - Parameters for importing descriptors.
   * @param params.requests - Array of descriptor requests.
   * @returns Promise resolving when descriptors are successfully imported.
   */
  public async importDescriptors(params: { requests: any[] }): Promise<void> {
    return this.callMethod('importdescriptors', params);
  }

  /**
   * Import multiple addresses or scripts to the wallet.
   * @param params - Parameters for importing multiple entries.
   * @param params.requests - Array of import requests.
   * @param params.options - (Optional) Additional options for import.
   * @returns Promise resolving when entries are successfully imported.
   */
  public async importMulti(params: { requests: any[]; options?: any }): Promise<void> {
    return this.callMethod('importmulti', params);
  }

  /**
   * Import a private key to the wallet.
   * @param params - Parameters for importing a private key.
   * @param params.privkey - The private key to import.
   * @param params.label - (Optional) Label for the imported key.
   * @param params.rescan - (Optional) Rescan the blockchain for transactions.
   * @returns Promise resolving to null when the key is successfully imported.
   */
  public async importPrivKey(params: { privkey: string; label?: string; rescan?: boolean }): Promise<null> {
    return this.callMethod('importprivkey', params);
  }

  /**
   * Import funds from a pruned transaction.
   * @param params - Parameters for importing pruned funds.
   * @param params.rawtransaction - The raw transaction data.
   * @param params.txoutproof - The transaction output proof.
   * @returns Promise resolving when funds are successfully imported.
   */
  public async importPrunedFunds(params: { rawtransaction: string; txoutproof: string }): Promise<void> {
    return this.callMethod('importprunedfunds', params);
  }

  /**
   * Import a public key to the wallet.
   * @param params - Parameters for importing a public key.
   * @param params.pubkey - The public key to import.
   * @param params.label - (Optional) Label for the imported key.
   * @param params.rescan - (Optional) Rescan the blockchain for transactions.
   * @returns Promise resolving to null when the key is successfully imported.
   */
  public async importPubKey(params: { pubkey: string; label?: string; rescan?: boolean }): Promise<null> {
    return this.callMethod('importpubkey', params);
  }

  /**
   * Import a wallet from a file.
   * @param params - Parameters for importing a wallet.
   * @param params.filename - The filename of the wallet to import.
   * @returns Promise resolving when the wallet is successfully imported.
   */
  public async importWallet(params: { filename: string }): Promise<void> {
    return this.callMethod('importwallet', params);
  }

  /**
   * Refill the key pool.
   * @param params - Parameters for refilling the key pool.
   * @param params.newsize - (Optional) New size of the key pool.
   * @returns Promise resolving when the key pool is successfully refilled.
   */
  public async keyPoolRefill(params: { newsize?: number }): Promise<void> {
    return this.callMethod('keypoolrefill', params);
  }

  /**
   * List all address groupings in the wallet.
   * @returns Promise resolving to an array of address groupings.
   */
  public async listAddressGroupings(): Promise<any[]> {
    return this.callMethod('listaddressgroupings');
  }

  /**
   * List all labels in the wallet.
   * @param params - Parameters for listing labels.
   * @param params.purpose - (Optional) Purpose of the labels ('send' or 'receive').
   * @returns Promise resolving to an array of labels.
   */
  public async listLabels(params: { purpose?: 'send' | 'receive' }): Promise<string[]> {
    return this.callMethod('listlabels', params);
  }

  /**
   * List all locked unspent transactions.
   * @returns Promise resolving to an array of locked unspent transactions.
   */
  public async listLockUnspent(): Promise<any[]> {
    return this.callMethod('listlockunspent');
  }

  /**
   * List all received transactions by address.
   * @param params - Parameters for listing received transactions.
   * @param params.minconf - (Optional) Minimum number of confirmations.
   * @param params.include_empty - (Optional) Include addresses with no transactions.
   * @param params.include_watchonly - (Optional) Include watch-only addresses.
   * @param params.address_filter - (Optional) Filter by specific address.
   * @param params.include_immature_coinbase - (Optional) Include immature coinbase transactions.
   * @returns Promise resolving to an array of received transactions.
   */
  public async listReceivedByAddress(params: {
    minconf?: number;
    include_empty?: boolean;
    include_watchonly?: boolean;
    address_filter?: string;
    include_immature_coinbase?: boolean;
  }): Promise<any[]> {
    return this.callMethod('listreceivedbyaddress', params);
  }

  /**
   * List all received transactions by label.
   * @param params - Parameters for listing received transactions by label.
   * @param params.minconf - (Optional) Minimum number of confirmations.
   * @param params.include_empty - (Optional) Include labels with no transactions.
   * @param params.include_watchonly - (Optional) Include watch-only addresses.
   * @param params.include_immature_coinbase - (Optional) Include immature coinbase transactions.
   * @returns Promise resolving to an array of received transactions.
   */
  public async listReceivedByLabel(params: {
    minconf?: number;
    include_empty?: boolean;
    include_watchonly?: boolean;
    include_immature_coinbase?: boolean;
  }): Promise<any[]> {
    return this.callMethod('listreceivedbylabel', params);
  }

  /**
   * List transactions since a specific block.
   * @param params - Parameters for listing transactions since a block.
   * @param params.blockhash - (Optional) Block hash to list transactions since.
   * @param params.target_confirmations - (Optional) Target number of confirmations.
   * @param params.include_watchonly - (Optional) Include watch-only addresses.
   * @param params.include_removed - (Optional) Include removed transactions.
   * @param params.include_change - (Optional) Include change transactions.
   * @param params.label - (Optional) Filter by specific label.
   * @returns Promise resolving to the list of transactions.
   */
  public async listSinceBlock(params: {
    blockhash?: string;
    target_confirmations?: number;
    include_watchonly?: boolean;
    include_removed?: boolean;
    include_change?: boolean;
    label?: string;
  }): Promise<any> {
    return this.callMethod('listsinceblock', params);
  }

  /**
   * List recent transactions.
   * @param params - Parameters for listing transactions.
   * @param params.label - (Optional) Filter by specific label.
   * @param params.count - (Optional) Number of transactions to list.
   * @param params.skip - (Optional) Number of transactions to skip.
   * @param params.include_watchonly - (Optional) Include watch-only addresses.
   * @returns Promise resolving to an array of transactions.
   */
  public async listTransactions(params: {
    label?: string;
    count?: number;
    skip?: number;
    include_watchonly?: boolean;
  }): Promise<any[]> {
    return this.callMethod('listtransactions', params);
  }

  /**
   * List unspent transaction outputs.
   * @param params - Parameters for listing unspent outputs.
   * @param params.minconf - (Optional) Minimum number of confirmations.
   * @param params.maxconf - (Optional) Maximum number of confirmations.
   * @param params.addresses - (Optional) Filter by specific addresses.
   * @param params.include_unsafe - (Optional) Include outputs that are not safe to spend.
   * @param params.query_options - (Optional) Additional query options.
   * @returns Promise resolving to an array of unspent transaction outputs.
   */
  public async listUnspent(params: {
    minconf?: number;
    maxconf?: number;
    addresses?: string[];
    include_unsafe?: boolean;
    query_options?: any;
  }): Promise<any[]> {
    return this.callMethod('listunspent', params);
  }

  /**
   * List all wallets in the wallet directory.
   * @returns Promise resolving to an array of wallet information.
   */
  public async listWalletDir(): Promise<any[]> {
    return this.callMethod('listwalletdir');
  }

  /**
   * List all loaded wallets.
   * @returns Promise resolving to an array of wallet names.
   */
  public async listWallets(): Promise<string[]> {
    return this.callMethod('listwallets');
  }

  /**
   * Load a wallet from a file.
   * @param params - Parameters for loading a wallet.
   * @param params.filename - The filename of the wallet to load.
   * @param params.load_on_startup - (Optional) Load the wallet on startup.
   * @returns Promise resolving to the result of the wallet loading.
   */
  public async loadWallet(params: { filename: string; load_on_startup?: boolean }): Promise<any> {
    return this.callMethod('loadwallet', params);
  }

  /**
   * Lock or unlock unspent transaction outputs.
   * @param params - Parameters for locking/unlocking outputs.
   * @param params.unlock - Whether to unlock the outputs.
   * @param params.transactions - The transactions to lock/unlock.
   * @returns Promise resolving when the operation is complete.
   */
  public async lockUnspent(params: { unlock: boolean; transactions: any[] }): Promise<void> {
    return this.callMethod('lockunspent', params);
  }

  /**
   * Bump the fee of a PSBT transaction.
   * @param params - Parameters for bumping the fee.
   * @param params.txid - The transaction ID of the PSBT.
   * @param params.options - (Optional) Additional options for fee bumping.
   * @returns Promise resolving to the result of the fee bump operation.
   */
  public async psbtBumpFee(params: { txid: string; options?: any }): Promise<any> {
    return this.callMethod('psbtbumpfee', params);
  }

  /**
   * Remove pruned funds from a transaction.
   * @param params - Parameters for removing pruned funds.
   * @param params.txid - The transaction ID to remove funds from.
   * @returns Promise resolving when the funds are removed.
   */
  public async removePrunedFunds(params: { txid: string }): Promise<void> {
    return this.callMethod('removeprunedfunds', params);
  }

  /**
   * Rescan the blockchain for wallet transactions.
   * @param params - Parameters for rescanning the blockchain.
   * @param params.start_height - (Optional) The starting block height.
   * @param params.stop_height - (Optional) The stopping block height.
   * @returns Promise resolving when the rescan is complete.
   */
  public async rescanBlockchain(params: { start_height?: number; stop_height?: number }): Promise<void> {
    return this.callMethod('rescanblockchain', params);
  }

  /**
   * Send a transaction with specified outputs.
   * @param params - Parameters for sending a transaction.
   * @param params.outputs - The outputs to send.
   * @param params.conf_target - (Optional) Confirmation target.
   * @param params.estimate_mode - (Optional) Fee estimation mode.
   * @param params.fee_rate - (Optional) Fee rate to use.
   * @param params.options - (Optional) Additional options.
   * @returns Promise resolving to the transaction ID.
   */
  public async send(params: {
    outputs: any[];
    conf_target?: number;
    estimate_mode?: EstimateMode;
    fee_rate?: number | string;
    options?: any;
  }): Promise<string> {
    return this.callMethod('send', params);
  }

  /**
   * Send multiple transactions to multiple addresses.
   * @param params - Parameters for sending multiple transactions.
   * @param params.dummy - (Optional) Dummy parameter for backward compatibility.
   * @param params.amounts - The amounts to send.
   * @param params.minconf - (Optional) Minimum number of confirmations.
   * @param params.comment - (Optional) Comment for the transaction.
   * @param params.subtractfeefrom - (Optional) Subtract fee from these outputs.
   * @param params.replaceable - (Optional) Allow transaction replacement.
   * @param params.conf_target - (Optional) Confirmation target.
   * @param params.estimate_mode - (Optional) Fee estimation mode.
   * @param params.fee_rate - (Optional) Fee rate to use.
   * @param params.verbose - (Optional) Verbose output.
   * @returns Promise resolving to the transaction ID.
   */
  public async sendMany(params: SendManyParams): Promise<string> {
    return this.callMethod('sendmany', params);
  }

  /**
   * Send a transaction to a specific address.
   * @param params - Parameters for sending a transaction.
   * @param params.address - The address to send to.
   * @param params.amount - The amount to send.
   * @param params.comment - (Optional) Comment for the transaction.
   * @param params.comment_to - (Optional) Comment for the recipient.
   * @param params.subtractfeefromamount - (Optional) Subtract fee from the amount.
   * @param params.replaceable - (Optional) Allow transaction replacement.
   * @param params.conf_target - (Optional) Confirmation target.
   * @param params.estimate_mode - (Optional) Fee estimation mode.
   * @param params.avoid_reuse - (Optional) Avoid address reuse.
   * @param params.fee_rate - (Optional) Fee rate to use.
   * @param params.verbose - (Optional) Verbose output.
   * @returns Promise resolving to the transaction ID.
   */
  public async sendToAddress(params: SendToAddressParams): Promise<string> {
    return this.callMethod('sendtoaddress', params);
  }

  /**
   * Set the HD seed for the wallet.
   * @param params - Parameters for setting the HD seed.
   * @param params.newkeypool - (Optional) Whether to create a new key pool.
   * @param params.seed - (Optional) The seed to set.
   * @returns Promise resolving when the seed is set.
   */
  public async setHdSeed(params: { newkeypool?: boolean; seed?: string }): Promise<void> {
    return this.callMethod('sethdseed', params);
  }

  /**
   * Set a label for a Bitcoin address.
   * @param params - Parameters for setting a label.
   * @param params.address - The address to label.
   * @param params.label - The label to set.
   * @returns Promise resolving when the label is set.
   */
  public async setLabel(params: { address: string; label: string }): Promise<void> {
    return this.callMethod('setlabel', params);
  }

  /**
   * Set the transaction fee per kilobyte.
   * @param params - Parameters for setting the transaction fee.
   * @param params.amount - The fee amount to set.
   * @returns Promise resolving to a boolean indicating success.
   */
  public async setTxFee(params: { amount: number | string }): Promise<boolean> {
    return this.callMethod('settxfee', params);
  }

  /**
   * Set a wallet flag.
   * @param params - Parameters for setting a wallet flag.
   * @param params.flag - The flag to set.
   * @param params.value - (Optional) The value to set for the flag.
   * @returns Promise resolving when the flag is set.
   */
  public async setWalletFlag(params: { flag: string; value?: boolean }): Promise<void> {
    return this.callMethod('setwalletflag', params);
  }

  /**
   * Sign a message with a Bitcoin address.
   * @param params - Parameters for signing a message.
   * @param params.address - The address to sign with.
   * @param params.message - The message to sign.
   * @returns Promise resolving to the signature as a string.
   */
  public async signMessage(params: { address: string; message: string }): Promise<string> {
    return this.callMethod('signmessage', params);
  }

  /**
   * Sign a raw transaction with the wallet.
   * @param params - Parameters for signing a raw transaction.
   * @param params.hexstring - The raw transaction hex string.
   * @param params.prevtxs - (Optional) Previous transactions.
   * @param params.sighashtype - (Optional) Signature hash type.
   * @returns Promise resolving to the signed transaction details.
   */
  public async signRawTransactionWithWallet(params: {
    hexstring: string;
    prevtxs?: any[];
    sighashtype?: SignatureHashType;
  }): Promise<any> {
    return this.callMethod('signrawtransactionwithwallet', params);
  }

  /**
   * Unload a wallet.
   * @param params - Parameters for unloading a wallet.
   * @param params.wallet_name - (Optional) The name of the wallet to unload.
   * @param params.load_on_startup - (Optional) Load the wallet on startup.
   * @returns Promise resolving when the wallet is unloaded.
   */
  public async unloadWallet(params: { wallet_name?: string; load_on_startup?: boolean }): Promise<void> {
    return this.callMethod('unloadwallet', params);
  }

  /**
   * Upgrade the wallet to the latest version.
   * @param params - Parameters for upgrading the wallet.
   * @param params.version - (Optional) The version to upgrade to.
   * @returns Promise resolving when the wallet is upgraded.
   */
  public async upgradeWallet(params: { version?: number }): Promise<void> {
    return this.callMethod('upgradewallet', params);
  }

  /**
   * Create a funded PSBT (Partially Signed Bitcoin Transaction).
   * @param params - Parameters for creating a funded PSBT.
   * @param params.inputs - (Optional) Inputs for the PSBT.
   * @param params.outputs - Outputs for the PSBT.
   * @param params.locktime - (Optional) Locktime for the PSBT.
   * @param params.options - (Optional) Additional options.
   * @param params.bip32derivs - (Optional) Include BIP32 derivations.
   * @returns Promise resolving to the created PSBT.
   */
  public async walletCreateFundedPsbt(params: {
    inputs?: any[];
    outputs: any[];
    locktime?: number;
    options?: any;
    bip32derivs?: boolean;
  }): Promise<any> {
    return this.callMethod('walletcreatefundedpsbt', params);
  }

  /**
   * Lock the wallet.
   * @returns Promise resolving when the wallet is locked.
   */
  public async walletLock(): Promise<null> {
    return this.callMethod('walletlock');
  }

  /**
   * Unlock the wallet with a passphrase.
   * @param params - Parameters for unlocking the wallet.
   * @param params.passphrase - The passphrase to unlock the wallet.
   * @param params.timeout - The timeout in seconds before the wallet is locked again.
   * @returns Promise resolving when the wallet is unlocked.
   */
  public async walletPassphrase(params: { passphrase: string; timeout: number }): Promise<null> {
    return this.callMethod('walletpassphrase', params);
  }

  /**
   * Change the wallet passphrase.
   * @param params - Parameters for changing the passphrase.
   * @param params.oldpassphrase - The current passphrase.
   * @param params.newpassphrase - The new passphrase to set.
   * @returns Promise resolving when the passphrase is changed.
   */
  public async walletPassphraseChange(params: { oldpassphrase: string; newpassphrase: string }): Promise<null> {
    return this.callMethod('walletpassphrasechange', params);
  }

  /**
   * Process a PSBT with the wallet.
   * @param params - Parameters for processing a PSBT.
   * @param params.psbt - The PSBT to process.
   * @param params.sign - (Optional) Whether to sign the PSBT.
   * @param params.sighashtype - (Optional) Signature hash type.
   * @param params.bip32derivs - (Optional) Include BIP32 derivations.
   * @param params.finalize - (Optional) Whether to finalize the PSBT.
   * @returns Promise resolving to the processed PSBT.
   */
  public async walletProcessPsbt(params: {
    psbt: string;
    sign?: boolean;
    sighashtype?: SignatureHashType;
    bip32derivs?: boolean;
    finalize?: boolean;
  }): Promise<any> {
    return this.callMethod('walletprocesspsbt', params);
  }

  /**
   * Calls a specified Bitcoin Core RPC method with optional parameters and options.
   * Utilizes caching to store and retrieve results of previous calls to improve performance.
   * If the method call fails due to a connection error, it will retry after waiting for the node to be available.
   * 
   * @param method - The name of the RPC method to call.
   * @param params - (Optional) Parameters to pass to the RPC method.
   * @param options - (Optional) Additional options, such as specifying a wallet.
   * @returns Promise resolving to the result of the RPC method call.
   */
  public async callMethod(method: string, params?: Record<string, any>, options?: { wallet?: string }): Promise<any> {
    const cacheKey = JSON.stringify({ method, params, options });
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey); // Return cached result if available
    }

    const makeRequest = async () => {
      try {
        const response = await this.makeRPCCall(method, params, options);
        const result = response.data.result;
        this.cache.set(cacheKey, result); // Cache the result for future use
        return result;
      } catch (error: any) {
        if (error.response) {
          // Handle RPC errors with detailed message and code
          throw new Error(
            `BitcoinCore RPC Error: ${error.response.data.error.message} (Code: ${error.response.data.error.code})`
          );
        } else if (error.request) {
          // Handle connection errors when no response is received
          throw new Error(`BitcoinCore Connection Error: No response from server`);
        } else {
          // Handle other request errors
          throw new Error(`BitcoinCore Request Error: ${error.message}`);
        }
      }
    };

    try {
      return await makeRequest();
    } catch (error: any) {
      if (error.message.includes('BitcoinCore Connection Error')) {
        // If connection error, add request to pending queue and wait for node
        this.pendingRequests.push({ method, params, options });
        await this.waitForNode();
        return this.callMethod(method, params, options); // Retry the method call
      } else {
        throw error; // Rethrow other errors
      }
    }
  }

  /**
   * Waits for the Bitcoin node to become available by repeatedly attempting to connect.
   * Processes any pending requests once the connection is successful.
   * 
   * @returns Promise resolving when the node is available and pending requests are processed.
   */
  private async waitForNode(): Promise<void> {
    while (true) {
      try {
        console.log('Attempting to connect to the node...');
        await this.makeRPCCall("ping"); // Ping the node to check availability
        console.log('Connection successful.');
        break; // Exit loop if connection is successful
      } catch {
        console.log('Failed to connect to the node. Retrying in 5 seconds...');
        await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait before retrying
      }
    }

    while (this.pendingRequests.length > 0) {
      const request = this.pendingRequests.shift();
      if (request) {
        await this.callMethod(request.method, request.params, request.options); // Process pending requests
      }
    }
  }

  /**
   * Makes an RPC call to the Bitcoin node using the specified method, parameters, and options.
   * Constructs the request URL based on the presence of a wallet option.
   * 
   * @param method - The RPC method to call.
   * @param params - (Optional) Parameters to pass to the RPC method.
   * @param options - (Optional) Additional options, such as specifying a wallet.
   * @returns Promise resolving to the response of the RPC call.
   */
  private makeRPCCall(method: string, params?: Record<string, any>, options?: { wallet?: string }): Promise<any> {
    const auth = {
      username: this.config.username, // Authentication username
      password: this.config.password, // Authentication password
    };
    const wallet = options?.wallet ?? this.config.wallet; // Determine wallet to use
    const url = wallet ? `${this.url}/wallet/${wallet}` : this.url; // Construct URL with wallet if specified

    return axios.post(
      url,
      {
        jsonrpc: '1.0', // JSON-RPC version
        id: `${Date.now()}`, // Unique ID for the request
        method, // RPC method name
        params: params ?? [], // Parameters for the RPC method
      },
      { auth } // Authentication credentials
    );
  }
}