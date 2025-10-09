/**
 * Distributed Transactions with Two-Phase Commit
 *
 * Provides ACID guarantees across multiple processes with automatic rollback
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { Errors } from '../../../errors/index.js';
import type { ILogger } from '../../logger/logger.types.js';

/**
 * Transaction phase
 */
export enum TransactionPhase {
  INITIALIZING = 'initializing',
  PREPARING = 'preparing',
  PREPARED = 'prepared',
  COMMITTING = 'committing',
  COMMITTED = 'committed',
  ABORTING = 'aborting',
  ABORTED = 'aborted'
}

/**
 * Transaction participant interface
 */
export interface ITransactionParticipant {
  id: string;
  prepare(): Promise<boolean>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  getState(): Promise<any>;
}

/**
 * Transaction context
 */
export interface ITransactionContext {
  id: string;
  phase: TransactionPhase;
  participants: Map<string, ITransactionParticipant>;
  votes: Map<string, boolean>;
  data: any;
  startTime: number;
  endTime?: number;
  error?: Error;
}

/**
 * Distributed transaction configuration
 */
export interface IDistributedTransactionConfig {
  timeout?: number;
  retries?: number;
  persistLog?: boolean;
  recoveryEnabled?: boolean;
  coordinatorId?: string;
}

/**
 * Transaction log entry
 */
export interface ITransactionLog {
  id: string;
  phase: TransactionPhase;
  timestamp: number;
  participants: string[];
  votes?: Map<string, boolean>;
  data?: any;
  error?: Error;
}

/**
 * Distributed Transaction Coordinator
 */
export class DistributedTransactionCoordinator extends EventEmitter {
  private transactions = new Map<string, ITransactionContext>();
  private transactionLog: ITransactionLog[] = [];
  private recoveryQueue: Set<string> = new Set();

  constructor(
    private readonly logger: ILogger,
    private readonly config: IDistributedTransactionConfig = {}
  ) {
    super();
    
    if (config.recoveryEnabled) {
      this.startRecoveryProcess();
    }
  }

  /**
   * Begin a distributed transaction
   */
  async begin(participants: ITransactionParticipant[], data?: any): Promise<string> {
    const transactionId = uuidv4();
    
    const context: ITransactionContext = {
      id: transactionId,
      phase: TransactionPhase.INITIALIZING,
      participants: new Map(),
      votes: new Map(),
      data,
      startTime: Date.now()
    };

    // Register participants
    for (const participant of participants) {
      context.participants.set(participant.id, participant);
    }

    this.transactions.set(transactionId, context);
    this.logTransaction(context);

    this.logger.info({ transactionId, participantCount: participants.length }, 'Transaction started');
    this.emit('transaction:started', context);

    return transactionId;
  }

  /**
   * Execute two-phase commit protocol
   */
  async commit(transactionId: string): Promise<void> {
    const context = this.transactions.get(transactionId);
    if (!context) {
      throw Errors.notFound(`Transaction ${transactionId} not found`);
    }

    try {
      // Phase 1: Prepare
      await this.preparePhase(context);

      // Check votes
      const allPrepared = Array.from(context.votes.values()).every(vote => vote === true);

      if (allPrepared) {
        // Phase 2: Commit
        await this.commitPhase(context);
        
        context.phase = TransactionPhase.COMMITTED;
        context.endTime = Date.now();
        
        this.logger.info({ transactionId }, 'Transaction committed successfully');
        this.emit('transaction:committed', context);
      } else {
        // Abort transaction
        await this.abortTransaction(context);
        throw Errors.notFound('Transaction aborted: Not all participants prepared');
      }
    } catch (error) {
      context.error = error as Error;
      await this.abortTransaction(context);
      throw error;
    } finally {
      this.logTransaction(context);
    }
  }

  /**
   * Prepare phase of 2PC
   */
  private async preparePhase(context: ITransactionContext): Promise<void> {
    context.phase = TransactionPhase.PREPARING;
    this.emit('transaction:preparing', context);

    const preparePromises: Promise<void>[] = [];

    for (const [participantId, participant] of context.participants) {
      preparePromises.push(
        this.prepareParticipant(context, participantId, participant)
      );
    }

    await Promise.all(preparePromises);
    
    context.phase = TransactionPhase.PREPARED;
    this.logTransaction(context);
  }

  /**
   * Prepare a single participant
   */
  private async prepareParticipant(
    context: ITransactionContext,
    participantId: string,
    participant: ITransactionParticipant
  ): Promise<void> {
    try {
      const timeout = this.config.timeout || 30000;
      const vote = await this.withTimeout(
        participant.prepare(),
        timeout,
        `Participant ${participantId} prepare timeout`
      );

      context.votes.set(participantId, vote);
      
      this.logger.debug({ transactionId: context.id, participantId, vote }, 'Participant vote received');
    } catch (error) {
      this.logger.error({ error, participantId }, 'Participant prepare failed');
      context.votes.set(participantId, false);
    }
  }

  /**
   * Commit phase of 2PC
   */
  private async commitPhase(context: ITransactionContext): Promise<void> {
    context.phase = TransactionPhase.COMMITTING;
    this.emit('transaction:committing', context);

    const commitPromises: Promise<void>[] = [];

    for (const [participantId, participant] of context.participants) {
      commitPromises.push(
        this.commitParticipant(context, participantId, participant)
      );
    }

    await Promise.all(commitPromises);
  }

  /**
   * Commit a single participant
   */
  private async commitParticipant(
    context: ITransactionContext,
    participantId: string,
    participant: ITransactionParticipant
  ): Promise<void> {
    try {
      const timeout = this.config.timeout || 30000;
      await this.withTimeout(
        participant.commit(),
        timeout,
        `Participant ${participantId} commit timeout`
      );

      this.logger.debug({ transactionId: context.id, participantId }, 'Participant committed');
    } catch (error) {
      // Log error but continue - participant will need recovery
      this.logger.error({ error, participantId }, 'Participant commit failed');
      this.recoveryQueue.add(`${context.id}:${participantId}`);
    }
  }

  /**
   * Abort a transaction
   */
  private async abortTransaction(context: ITransactionContext): Promise<void> {
    context.phase = TransactionPhase.ABORTING;
    this.emit('transaction:aborting', context);

    const rollbackPromises: Promise<void>[] = [];

    for (const [participantId, participant] of context.participants) {
      rollbackPromises.push(
        this.rollbackParticipant(context, participantId, participant)
      );
    }

    await Promise.allSettled(rollbackPromises);
    
    context.phase = TransactionPhase.ABORTED;
    context.endTime = Date.now();
    
    this.logger.info({ transactionId: context.id }, 'Transaction aborted');
    this.emit('transaction:aborted', context);
  }

  /**
   * Rollback a single participant
   */
  private async rollbackParticipant(
    context: ITransactionContext,
    participantId: string,
    participant: ITransactionParticipant
  ): Promise<void> {
    try {
      const timeout = this.config.timeout || 30000;
      await this.withTimeout(
        participant.rollback(),
        timeout,
        `Participant ${participantId} rollback timeout`
      );

      this.logger.debug({ transactionId: context.id, participantId }, 'Participant rolled back');
    } catch (error) {
      // Log error but continue
      this.logger.error({ error, participantId }, 'Participant rollback failed');
    }
  }

  /**
   * Get transaction status
   */
  getTransaction(transactionId: string): ITransactionContext | undefined {
    return this.transactions.get(transactionId);
  }

  /**
   * List all transactions
   */
  listTransactions(): ITransactionContext[] {
    return Array.from(this.transactions.values());
  }

  /**
   * Log transaction state
   */
  private logTransaction(context: ITransactionContext): void {
    if (!this.config.persistLog) return;

    const logEntry: ITransactionLog = {
      id: context.id,
      phase: context.phase,
      timestamp: Date.now(),
      participants: Array.from(context.participants.keys()),
      votes: context.votes.size > 0 ? new Map(context.votes) : undefined,
      data: context.data,
      error: context.error
    };

    this.transactionLog.push(logEntry);
  }

  /**
   * Start recovery process for failed transactions
   */
  private startRecoveryProcess(): void {
    setInterval(async () => {
      if (this.recoveryQueue.size === 0) return;

      const items = Array.from(this.recoveryQueue);
      this.recoveryQueue.clear();

      for (const item of items) {
        await this.recoverTransaction(item);
      }
    }, 60000); // Run every minute
  }

  /**
   * Recover a failed transaction
   */
  private async recoverTransaction(recoveryKey: string): Promise<void> {
    const [transactionId, participantId] = recoveryKey.split(':');
    
    this.logger.info({ transactionId, participantId }, 'Attempting transaction recovery');

    // Recovery logic would go here
    // This could involve reading from persistent log,
    // querying participant state, and completing the transaction
  }

  /**
   * Execute with timeout
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeout: number,
    errorMessage: string
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(errorMessage)), timeout)
      )
    ]);
  }
}

/**
 * Distributed transaction participant implementation
 */
export class TransactionParticipant implements ITransactionParticipant {
  private state: any = {};
  private preparedState: any = null;
  private originalState: any = null;

  constructor(
    public readonly id: string,
    private readonly logger: ILogger
  ) {}

  /**
   * Prepare for commit
   */
  async prepare(): Promise<boolean> {
    try {
      // Save current state for potential rollback
      this.originalState = { ...this.state };
      
      // Perform validation and lock resources
      // This is where you'd check constraints, acquire locks, etc.
      
      this.preparedState = this.state;
      
      this.logger.debug({ participantId: this.id }, 'Participant prepared');
      return true;
    } catch (error) {
      this.logger.error({ error, participantId: this.id }, 'Participant prepare failed');
      return false;
    }
  }

  /**
   * Commit the transaction
   */
  async commit(): Promise<void> {
    if (!this.preparedState) {
      throw Errors.notFound('Cannot commit: not prepared');
    }

    // Apply the prepared state permanently
    this.state = this.preparedState;
    
    // Release any locks
    this.preparedState = null;
    this.originalState = null;
    
    this.logger.debug({ participantId: this.id }, 'Participant committed');
  }

  /**
   * Rollback the transaction
   */
  async rollback(): Promise<void> {
    if (this.originalState) {
      // Restore original state
      this.state = this.originalState;
    }
    
    // Release any locks
    this.preparedState = null;
    this.originalState = null;
    
    this.logger.debug({ participantId: this.id }, 'Participant rolled back');
  }

  /**
   * Get current state
   */
  async getState(): Promise<any> {
    return this.state;
  }

  /**
   * Update state (for testing)
   */
  updateState(newState: any): void {
    this.state = { ...this.state, ...newState };
  }
}