import { describe, it, expect, vi } from 'vitest'
import { withRetry, CircuitBreaker, isTransientError, createRetryWrapper } from '../src/retry.js'

describe('Retry Logic', () => {
  describe('isTransientError', () => {
    it('should identify network errors as transient', () => {
      expect(isTransientError({ code: 'ECONNREFUSED' })).toBe(true)
      expect(isTransientError({ code: 'ETIMEDOUT' })).toBe(true)
      expect(isTransientError({ code: 'ECONNRESET' })).toBe(true)
      expect(isTransientError({ code: 'EPIPE' })).toBe(true)
    })

    it('should identify PostgreSQL transient errors', () => {
      expect(isTransientError({ code: '57P03' })).toBe(true)
      expect(isTransientError({ code: '08006' })).toBe(true)
      expect(isTransientError({ code: '40001' })).toBe(true)
      expect(isTransientError({ code: '40P01' })).toBe(true)
    })

    it('should identify MySQL transient errors', () => {
      expect(isTransientError({ code: 'ER_LOCK_DEADLOCK' })).toBe(true)
      expect(isTransientError({ code: 'ER_LOCK_WAIT_TIMEOUT' })).toBe(true)
      expect(isTransientError({ code: 'ER_CON_COUNT_ERROR' })).toBe(true)
    })

    it('should identify SQLite transient errors', () => {
      expect(isTransientError({ code: 'SQLITE_BUSY' })).toBe(true)
      expect(isTransientError({ code: 'SQLITE_LOCKED' })).toBe(true)
    })

    it('should return false for non-transient errors', () => {
      expect(isTransientError({ code: 'UNKNOWN_ERROR' })).toBe(false)
      expect(isTransientError({ code: '23505' })).toBe(false) // unique violation
      expect(isTransientError({})).toBe(false)
      expect(isTransientError(null)).toBe(false)
      expect(isTransientError(undefined)).toBe(false)
      expect(isTransientError('string error')).toBe(false)
    })
  })

  describe('createRetryWrapper', () => {
    it('should wrap a function with retry logic', async () => {
      let attempts = 0
      const originalFn = async (value: string) => {
        attempts++
        if (attempts < 2) {
          throw new Error('Temporary failure')
        }
        return `Result: ${value}`
      }

      const wrappedFn = createRetryWrapper(originalFn, {
        maxAttempts: 3,
        delayMs: 10,
        shouldRetry: () => true
      })

      const result = await wrappedFn('test')
      expect(result).toBe('Result: test')
      expect(attempts).toBe(2)
    })

    it('should preserve function parameters and return types', async () => {
      const originalFn = async (a: number, b: string, c?: boolean) => {
        return { a, b, c }
      }

      const wrappedFn = createRetryWrapper(originalFn, {
        maxAttempts: 2,
        delayMs: 10
      })

      const result = await wrappedFn(42, 'hello', true)
      expect(result).toEqual({ a: 42, b: 'hello', c: true })
    })

    it('should fail after max attempts', async () => {
      const originalFn = async () => {
        throw new Error('Always fails')
      }

      const wrappedFn = createRetryWrapper(originalFn, {
        maxAttempts: 2,
        delayMs: 10,
        shouldRetry: () => true
      })

      await expect(wrappedFn()).rejects.toThrow('Always fails')
    })
  })

  describe('withRetry', () => {
    it('should succeed on first try', async () => {
      let attempts = 0
      const fn = async () => {
        attempts++
        return 'success'
      }

      const result = await withRetry(fn)

      expect(result).toBe('success')
      expect(attempts).toBe(1)
    })

    it('should retry on failure and eventually succeed', async () => {
      let attempts = 0
      const fn = async () => {
        attempts++
        if (attempts < 3) {
          throw new Error('Temporary failure')
        }
        return 'success'
      }

      const result = await withRetry(fn, {
        maxAttempts: 3,
        delayMs: 10,
        shouldRetry: () => true  // Always retry for this test
      })

      expect(result).toBe('success')
      expect(attempts).toBe(3)
    })

    it('should fail after max attempts', async () => {
      let attempts = 0
      const fn = async () => {
        attempts++
        throw new Error('Persistent failure')
      }

      await expect(
        withRetry(fn, {
          maxAttempts: 3,
          delayMs: 10,
          shouldRetry: () => true  // Always retry for test
        })
      ).rejects.toThrow('Persistent failure')

      expect(attempts).toBe(3)
    })

    it('should use exponential backoff', async () => {
      const delays: number[] = []
      let lastTime = Date.now()

      const fn = async () => {
        const now = Date.now()
        delays.push(now - lastTime)
        lastTime = now
        throw new Error('Failure')
      }

      try {
        await withRetry(fn, {
          maxAttempts: 4,
          delayMs: 10,
          backoff: true,
          shouldRetry: () => true
        })
      } catch {
        // Expected to fail
      }

      // First attempt is immediate
      // Each subsequent delay should be roughly double the previous
      // Allow some variance due to timing
      expect(delays[1]).toBeGreaterThanOrEqual(8)  // ~10ms
      expect(delays[2]).toBeGreaterThanOrEqual(15) // ~20ms
      expect(delays[3]).toBeGreaterThanOrEqual(30) // ~40ms
    })

    it('should call onRetry callback', async () => {
      const onRetry = vi.fn()
      let attempts = 0

      const fn = async () => {
        attempts++
        if (attempts < 3) {
          throw new Error('Retry me')
        }
        return 'success'
      }

      await withRetry(fn, {
        maxAttempts: 3,
        delayMs: 10,
        onRetry,
        shouldRetry: () => true
      })

      expect(onRetry).toHaveBeenCalledTimes(2)
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error))
      expect(onRetry).toHaveBeenCalledWith(2, expect.any(Error))
    })

    it('should handle async errors correctly', async () => {
      const fn = async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        throw new Error('Async failure')
      }

      await expect(
        withRetry(fn, {
          maxAttempts: 2,
          delayMs: 10,
          shouldRetry: () => false  // Don't retry
        })
      ).rejects.toThrow('Async failure')
    })

    it('should respect retryIf predicate', async () => {
      let attempts = 0
      const fn = async () => {
        attempts++
        if (attempts === 1) {
          throw new Error('Retryable')
        }
        throw new Error('Non-retryable')
      }

      const shouldRetry = (error: unknown) => {
        return error instanceof Error && error.message === 'Retryable'
      }

      await expect(
        withRetry(fn, {
          maxAttempts: 3,
          delayMs: 10,
          shouldRetry
        })
      ).rejects.toThrow('Non-retryable')

      expect(attempts).toBe(2) // First attempt + one retry
    })
  })

  describe('CircuitBreaker', () => {
    it('should allow requests when closed', async () => {
      const breaker = new CircuitBreaker()
      const fn = async () => 'success'

      const result = await breaker.execute(fn)
      expect(result).toBe('success')
      expect(breaker.getState().state).toBe('closed')
    })

    it('should open after threshold failures', async () => {
      const breaker = new CircuitBreaker(3, 100)  // threshold, resetTimeMs

      const fn = async () => {
        throw new Error('Failure')
      }

      // Fail 3 times
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(fn)).rejects.toThrow('Failure')
      }

      expect(breaker.getState().state).toBe('open')

      // Should immediately reject when open
      await expect(breaker.execute(fn)).rejects.toThrow('Circuit breaker is open')
    })

    it('should transition to half-open after timeout', async () => {
      const breaker = new CircuitBreaker(2, 50)  // threshold, resetTimeMs

      const fn = async () => {
        throw new Error('Failure')
      }

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        await expect(breaker.execute(fn)).rejects.toThrow()
      }

      expect(breaker.getState().state).toBe('open')

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 60))

      // Should transition to half-open on next request
      const successFn = async () => 'success'
      const result = await breaker.execute(successFn)

      expect(result).toBe('success')
      expect(breaker.getState().state).toBe('closed')
    })

    it('should close from half-open on success', async () => {
      const breaker = new CircuitBreaker(2, 50)

      let shouldFail = true
      const fn = async () => {
        if (shouldFail) {
          throw new Error('Failure')
        }
        return 'success'
      }

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        await expect(breaker.execute(fn)).rejects.toThrow()
      }

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 60))

      // Now succeed
      shouldFail = false
      const result = await breaker.execute(fn)

      expect(result).toBe('success')
      expect(breaker.getState().state).toBe('closed')
    })

    it('should re-open from half-open on failure', async () => {
      const breaker = new CircuitBreaker(2, 50)

      const failFn = async () => {
        throw new Error('Failure')
      }

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        await expect(breaker.execute(failFn)).rejects.toThrow()
      }

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 60))

      // Fail again in half-open state
      await expect(breaker.execute(failFn)).rejects.toThrow('Failure')

      expect(breaker.getState().state).toBe('open')
    })

    it('should reset circuit breaker', async () => {
      const breaker = new CircuitBreaker(2)  // threshold only

      const fn = async () => {
        throw new Error('Failure')
      }

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        await expect(breaker.execute(fn)).rejects.toThrow()
      }

      expect(breaker.getState().state).toBe('open')

      // Reset
      breaker.reset()
      expect(breaker.getState().state).toBe('closed')

      // Should work again
      const successFn = async () => 'success'
      const result = await breaker.execute(successFn)
      expect(result).toBe('success')
    })

    it('should handle concurrent requests', async () => {
      const breaker = new CircuitBreaker()
      let counter = 0

      const fn = async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return ++counter
      }

      // Execute multiple concurrent requests
      const results = await Promise.all([
        breaker.execute(fn),
        breaker.execute(fn),
        breaker.execute(fn)
      ])

      expect(results).toHaveLength(3)
      expect(new Set(results).size).toBe(3) // All unique
      expect(breaker.getState().state).toBe('closed')
    })

    it('should track failure patterns', async () => {
      const breaker = new CircuitBreaker(5, 100)  // threshold, resetTimeMs

      let callCount = 0
      const fn = async () => {
        callCount++
        // Fail on odd calls, succeed on even calls
        if (callCount % 2 === 1) {
          throw new Error('Controlled failure')
        }
        return 'success'
      }

      const results = []
      for (let i = 0; i < 10; i++) {
        try {
          const result = await breaker.execute(fn)
          results.push(result)
        } catch (error) {
          results.push('failed')
        }

        // Prevent circuit from opening too quickly
        if (breaker.getState().state === 'open') {
          break
        }
      }

      // Should have some successes and failures
      expect(results).toContain('success')
      expect(results).toContain('failed')
    })
  })

  describe('Integration with Database', () => {
    it('should retry database connection failures', async () => {
      let attempts = 0
      const mockDbOperation = async () => {
        attempts++
        if (attempts < 2) {
          const error = new Error('Connection lost')
          ;(error as any).code = 'ECONNRESET'
          throw error
        }
        return { id: 1, name: 'Test' }
      }

      const result = await withRetry(mockDbOperation, {
        maxAttempts: 3,
        delayMs: 10,
        shouldRetry: (error: any) => {
          return error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT'
        }
      })

      expect(result).toEqual({ id: 1, name: 'Test' })
      expect(attempts).toBe(2)
    })

    it('should use circuit breaker for database operations', async () => {
      const breaker = new CircuitBreaker(2, 50)

      let dbAvailable = false
      const dbOperation = async () => {
        if (!dbAvailable) {
          throw new Error('Database unavailable')
        }
        return 'Data retrieved'
      }

      // Database is down
      await expect(breaker.execute(dbOperation)).rejects.toThrow()
      await expect(breaker.execute(dbOperation)).rejects.toThrow()

      // Circuit should be open
      expect(breaker.getState().state).toBe('open')
      await expect(breaker.execute(dbOperation)).rejects.toThrow('Circuit breaker is open')

      // Wait and fix database
      await new Promise(resolve => setTimeout(resolve, 60))
      dbAvailable = true

      // Should work now
      const result = await breaker.execute(dbOperation)
      expect(result).toBe('Data retrieved')
      expect(breaker.getState().state).toBe('closed')
    })
  })
})