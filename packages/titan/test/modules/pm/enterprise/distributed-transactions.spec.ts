/**
 * Distributed Transactions Tests
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  DistributedTransactionCoordinator,
  TransactionParticipant,
  TransactionPhase,
  type ITransactionParticipant
} from '../../../../src/modules/pm/enterprise/distributed-transactions.js';

// Mock logger
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: jest.fn(() => mockLogger)
} as any;

describe('Distributed Transactions', () => {
  let coordinator: DistributedTransactionCoordinator;

  beforeEach(() => {
    coordinator = new DistributedTransactionCoordinator(mockLogger);
  });

  describe('Two-Phase Commit', () => {
    it('should successfully commit when all participants vote yes', async () => {
      // Create participants
      const participant1 = new TransactionParticipant('participant1', mockLogger);
      const participant2 = new TransactionParticipant('participant2', mockLogger);

      // Mock prepare to return true
      jest.spyOn(participant1, 'prepare').mockResolvedValue(true);
      jest.spyOn(participant2, 'prepare').mockResolvedValue(true);

      // Spy on commit methods
      const commit1Spy = jest.spyOn(participant1, 'commit').mockResolvedValue();
      const commit2Spy = jest.spyOn(participant2, 'commit').mockResolvedValue();

      // Begin transaction
      const txId = await coordinator.begin([participant1, participant2]);

      // Commit transaction
      await coordinator.commit(txId);

      // Verify prepare and commit were called
      expect(participant1.prepare).toHaveBeenCalled();
      expect(participant2.prepare).toHaveBeenCalled();
      expect(commit1Spy).toHaveBeenCalled();
      expect(commit2Spy).toHaveBeenCalled();

      // Check transaction state
      const tx = coordinator.getTransaction(txId);
      expect(tx?.phase).toBe(TransactionPhase.COMMITTED);
    });

    it('should abort when any participant votes no', async () => {
      // Create participants
      const participant1 = new TransactionParticipant('participant1', mockLogger);
      const participant2 = new TransactionParticipant('participant2', mockLogger);

      // Mock prepare - participant2 votes no
      jest.spyOn(participant1, 'prepare').mockResolvedValue(true);
      jest.spyOn(participant2, 'prepare').mockResolvedValue(false);

      // Spy on rollback methods
      const rollback1Spy = jest.spyOn(participant1, 'rollback').mockResolvedValue();
      const rollback2Spy = jest.spyOn(participant2, 'rollback').mockResolvedValue();

      // Begin transaction
      const txId = await coordinator.begin([participant1, participant2]);

      // Commit should fail
      await expect(coordinator.commit(txId)).rejects.toThrow();

      // Verify rollback was called
      expect(rollback1Spy).toHaveBeenCalled();
      expect(rollback2Spy).toHaveBeenCalled();

      // Check transaction state
      const tx = coordinator.getTransaction(txId);
      expect(tx?.phase).toBe(TransactionPhase.ABORTED);
    });

    it('should handle participant timeouts', async () => {
      // Create coordinator with short timeout
      const shortTimeoutCoordinator = new DistributedTransactionCoordinator(
        mockLogger,
        { timeout: 100 }
      );

      // Create participants
      const participant1 = new TransactionParticipant('participant1', mockLogger);
      const participant2 = new TransactionParticipant('participant2', mockLogger);

      // Mock prepare - participant2 times out
      jest.spyOn(participant1, 'prepare').mockResolvedValue(true);
      jest.spyOn(participant2, 'prepare').mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(true), 200))
      );

      // Begin transaction
      const txId = await shortTimeoutCoordinator.begin([participant1, participant2]);

      // Commit should fail due to timeout
      await expect(shortTimeoutCoordinator.commit(txId)).rejects.toThrow();

      // Check transaction state
      const tx = shortTimeoutCoordinator.getTransaction(txId);
      expect(tx?.phase).toBe(TransactionPhase.ABORTED);
    });
  });

  describe('Transaction Participant', () => {
    it('should manage state transitions correctly', async () => {
      const participant = new TransactionParticipant('test', mockLogger);

      // Update state
      participant.updateState({ value: 10 });

      // Prepare
      const canCommit = await participant.prepare();
      expect(canCommit).toBe(true);

      // Commit
      await participant.commit();

      // Check final state
      const state = await participant.getState();
      expect(state).toHaveProperty('value', 10);
    });

    it('should rollback to original state', async () => {
      const participant = new TransactionParticipant('test', mockLogger);

      // Set initial state
      participant.updateState({ value: 5 });

      // Prepare with new state
      await participant.prepare();
      participant.updateState({ value: 15 });

      // Rollback
      await participant.rollback();

      // Check state was restored
      const state = await participant.getState();
      expect(state).toHaveProperty('value', 5);
    });

    it('should not allow commit without prepare', async () => {
      const participant = new TransactionParticipant('test', mockLogger);

      // Try to commit without prepare
      await expect(participant.commit()).rejects.toThrow('Cannot commit: not prepared');
    });
  });

  describe('Transaction Recovery', () => {
    it('should log transactions for recovery', async () => {
      // Create coordinator with logging enabled
      const loggingCoordinator = new DistributedTransactionCoordinator(
        mockLogger,
        { persistLog: true }
      );

      const participant = new TransactionParticipant('test', mockLogger);
      jest.spyOn(participant, 'prepare').mockResolvedValue(true);
      jest.spyOn(participant, 'commit').mockResolvedValue();

      // Begin and commit transaction
      const txId = await loggingCoordinator.begin([participant]);
      await loggingCoordinator.commit(txId);

      // Check transaction was logged
      const tx = loggingCoordinator.getTransaction(txId);
      expect(tx).toBeDefined();
      expect(tx?.phase).toBe(TransactionPhase.COMMITTED);
    });

    it('should list all transactions', async () => {
      const participant1 = new TransactionParticipant('p1', mockLogger);
      const participant2 = new TransactionParticipant('p2', mockLogger);

      // Begin multiple transactions
      const tx1 = await coordinator.begin([participant1]);
      const tx2 = await coordinator.begin([participant2]);

      // List transactions
      const transactions = coordinator.listTransactions();
      expect(transactions).toHaveLength(2);
      expect(transactions.map(t => t.id)).toContain(tx1);
      expect(transactions.map(t => t.id)).toContain(tx2);
    });
  });

  describe('Event Emissions', () => {
    it('should emit events during transaction lifecycle', async () => {
      const events: string[] = [];

      // Listen to events
      coordinator.on('transaction:started', () => events.push('started'));
      coordinator.on('transaction:preparing', () => events.push('preparing'));
      coordinator.on('transaction:committing', () => events.push('committing'));
      coordinator.on('transaction:committed', () => events.push('committed'));

      const participant = new TransactionParticipant('test', mockLogger);
      jest.spyOn(participant, 'prepare').mockResolvedValue(true);
      jest.spyOn(participant, 'commit').mockResolvedValue();

      // Execute transaction
      const txId = await coordinator.begin([participant]);
      await coordinator.commit(txId);

      // Verify events were emitted in order
      expect(events).toEqual(['started', 'preparing', 'committing', 'committed']);
    });

    it('should emit abort events on failure', async () => {
      const events: string[] = [];

      // Listen to events
      coordinator.on('transaction:aborting', () => events.push('aborting'));
      coordinator.on('transaction:aborted', () => events.push('aborted'));

      const participant = new TransactionParticipant('test', mockLogger);
      jest.spyOn(participant, 'prepare').mockResolvedValue(false);

      // Execute transaction
      const txId = await coordinator.begin([participant]);
      await expect(coordinator.commit(txId)).rejects.toThrow();

      // Verify abort events were emitted
      expect(events).toContain('aborting');
      expect(events).toContain('aborted');
    });
  });
});
