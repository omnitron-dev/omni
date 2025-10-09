# Transport Layer Test Coverage Strategy

## Executive Summary

**Current Overall Transport Coverage:** 70.23%
**Target Coverage:** 85%+
**Gap:** 14.77%

This document outlines the strategy to achieve >85% coverage across the Transport layer, focusing on critical uncovered lines in base-transport, transport-adapter, TCP, and Unix transports.

---

## Coverage Breakdown by File

### 1. transport-adapter.ts - **44.72%** ⚠️ CRITICAL
**Current:** 44.72% statements, 44.44% branches, 34.54% functions
**Uncovered Lines:** 55, 62-90, 128, 146-156, 164-166, 176-233, 247-365, 389, 450

**Critical Gaps:**
- **BinaryTransportAdapter (lines 62-90):** Error handling in send method for invalid data types
- **BinaryTransportAdapter (lines 146-156):** ArrayBuffer/Uint8Array conversion paths
- **BinaryTransportAdapter (lines 164-166):** Error callback path when no callback provided
- **NativeWebSocketWrapper (lines 176-233):** Backward compatibility wrapper for native WebSocket
- **NativeWebSocketWrapper (lines 247-365):** All methods of WebSocket wrapper (send, sendPacket, close, ping)
- **TransportConnectionFactory (lines 222-234):** Static connect method
- **TransportConnectionFactory (lines 246-274):** isNativeWebSocket and fromNativeWebSocket methods

**Impact:** High - This file bridges all transports, crucial for system reliability

**Test Cases Needed:** 15-20 tests

---

### 2. unix-transport.ts - **59.2%** ⚠️ CRITICAL
**Current:** 59.2% statements, 47.22% branches, 55.17% functions
**Uncovered Lines:** 129-130, 176, 186, 199, 266-407

**Critical Gaps:**
- **NamedPipeTransport (lines 266-407):** Entire Windows named pipe implementation untested
  - connect method (lines 290-328)
  - createServer method (lines 333-367)
  - parseAddress method (lines 372-397)
  - isValidAddress method (lines 402-409)
- **Error paths in UnixSocketConnection:** Socket timeout error handling (lines 129-130)
- **Error paths in server creation:** EEXIST handling during mkdir (line 176)
- **Error paths in connect:** Error propagation beyond ENOENT (line 186)
- **Socket permissions:** chmod error handling (line 199)

**Impact:** High - Unix sockets are critical for IPC, named pipes untested on Windows

**Test Cases Needed:** 12-15 tests (mostly for NamedPipeTransport)

---

### 3. tcp-transport.ts - **72.22%** ⚠️ MEDIUM
**Current:** 72.22% statements, 60.81% branches, 74.46% functions
**Uncovered Lines:** 51, 62, 75, 87-89, 114-115, 159-162, 173, 204-244, 271-273, 281, 296, 321-326, 342, 445

**Critical Gaps:**
- **TcpConnection socket options (lines 62, 75):** noDelay and timeout configuration paths
- **TcpConnection state handling (lines 87-89):** CONNECTING state on socket creation
- **TcpConnection error handling (lines 114-115):** Timeout event handling
- **TcpConnection send (lines 159-162):** ArrayBuffer and Uint8Array conversion
- **TcpConnection close (lines 204-244):** Force destroy timeout path (line 204-208)
- **TcpConnection reconnection (lines 215-246):** doReconnect method completely untested
- **TcpServer port getter (lines 271-273, 281):** String address handling edge cases
- **TcpServer error handling (line 296):** Server error event
- **TcpServer listen (lines 321-326):** Already listening edge case
- **TcpServer close (line 342):** Server close error callback
- **TcpTransport validation (line 445):** isValidAddress catch block

**Impact:** Medium-High - TCP is primary transport for distributed systems

**Test Cases Needed:** 10-12 tests

---

### 4. base-transport.ts - **84.56%** ✅ GOOD
**Current:** 84.56% statements, 70% branches, 78.94% functions
**Uncovered Lines:** 123, 218-219, 225-227, 247-248, 253, 316, 328, 338, 372-375, 420, 429, 438, 455-460

**Critical Gaps:**
- **BaseConnection handleDisconnect (lines 218-219):** Reconnection scheduling logic
- **BaseConnection ping error (lines 225-227):** sendPacket error path in ping
- **BaseConnection cleanup (lines 247-253):** Pending pings rejection on close
- **BaseServer broadcast errors (line 316):** Individual connection broadcast failures
- **BaseServer broadcastPacket errors (line 328):** Individual packet send failures
- **BaseServer metrics tracking (line 338):** Data event handler
- **BaseTransport parseAddress (lines 372-375, 420, 429, 438):** Edge cases in URL parsing
- **BaseTransport parseAddress (lines 455-460):** Port validation and default handling

**Impact:** Medium - Base classes are well-tested, gaps are edge cases

**Test Cases Needed:** 8-10 tests

---

### 5. websocket-transport.ts - **80.48%** ✅ ACCEPTABLE
**Current:** 80.48% statements, 64.64% branches, 85.71% functions
**Uncovered Lines:** 134, 152, 183-186, 212-213, 245, 264, 275, 291, 307, 341-342, 380-401, 413, 475

**Critical Gaps:**
- SSL/TLS validation paths
- Server upgrade handling edge cases
- Connection state edge cases
- Error handling in server close

**Impact:** Low - Already above 80%, mostly edge cases

**Test Cases Needed:** 5-7 tests

---

### 6. transport-registry.ts - **85.45%** ✅ GOOD
**Current:** 85.45% statements, 85.71% branches, 85% functions
**Uncovered Lines:** 132-133, 144-148, 163, 188-195

**Critical Gaps:**
- Error paths in registration
- Protocol alias handling edge cases
- Default transport registration edge cases

**Impact:** Low - Already above target

**Test Cases Needed:** 3-5 tests

---

## Priority Test Implementation Plan

### Phase 1: Critical Files (Est. 30-35 tests)
**Target: Bring transport-adapter.ts and unix-transport.ts to >80%**

#### 1.1 transport-adapter.ts Tests (15-20 tests)
**File:** `test/netron/transport/transport-adapter-advanced.spec.ts`

1. **BinaryTransportAdapter - Data Type Conversion**
   - Test ArrayBuffer send conversion
   - Test Uint8Array send conversion
   - Test string send conversion
   - Test invalid data type with callback
   - Test invalid data type without callback (error throw)

2. **BinaryTransportAdapter - Binary Type Handling**
   - Test binaryType getter/setter
   - Test invalid binaryType rejection
   - Test ArrayBuffer binaryType with packet events
   - Test nodebuffer binaryType with data events

3. **BinaryTransportAdapter - Socket Properties**
   - Test _socket property with address parsing
   - Test remoteAddress/remotePort extraction
   - Test localAddress/localPort extraction

4. **NativeWebSocketWrapper - WebSocket Compatibility**
   - Test wrapping native WebSocket
   - Test state mapping (CONNECTING, OPEN, CLOSING, CLOSED)
   - Test send with callback
   - Test sendPacket encoding
   - Test close method
   - Test ping/pong protocol
   - Test event mapping (open, message, error, close)
   - Test message data conversion (Buffer, ArrayBuffer, array)

5. **TransportConnectionFactory - Connection Creation**
   - Test static connect method
   - Test fromConnection method
   - Test isNativeWebSocket detection
   - Test getAdapter with native WebSocket
   - Test getAdapter with ITransportConnection

**Expected Coverage Gain:** 44.72% → 75%+ (30% increase)

#### 1.2 unix-transport.ts Tests (12-15 tests)
**File:** `test/netron/transport/named-pipe-transport.spec.ts`

1. **NamedPipeTransport - Windows Platform (if on Windows)**
   - Test named pipe creation
   - Test named pipe connection
   - Test pipe path formatting
   - Test createServer with pipe name
   - Test createServer with options
   - Test parseAddress for pipe:// URLs
   - Test parseAddress for raw pipe names
   - Test isValidAddress validation

2. **UnixSocketTransport - Error Paths**
   - Test connection timeout error
   - Test mkdir EEXIST handling
   - Test socket stat error (non-ENOENT)
   - Test chmod error during server creation
   - Test invalid socket file rejection

3. **Cross-Platform Tests**
   - Test platform detection (isWindows)
   - Test appropriate transport selection per platform

**Expected Coverage Gain:** 59.2% → 85%+ (26% increase)

---

### Phase 2: Medium Priority Files (Est. 15-20 tests)
**Target: Bring tcp-transport.ts and base-transport.ts to >85%**

#### 2.1 tcp-transport.ts Tests (10-12 tests)
**File:** `test/netron/transport/tcp-transport-advanced.spec.ts`

1. **TcpConnection - Socket Options**
   - Test noDelay option configuration
   - Test timeout option configuration
   - Test allowHalfOpen option
   - Test socket in CONNECTING state before connect event

2. **TcpConnection - Data Conversion**
   - Test send with ArrayBuffer
   - Test send with Uint8Array
   - Test send when socket not open (error)

3. **TcpConnection - Reconnection**
   - Test doReconnect success
   - Test doReconnect timeout
   - Test doReconnect with missing address
   - Test automatic reconnection triggering

4. **TcpConnection - Timeout Handling**
   - Test socket timeout event
   - Test force destroy on close timeout

5. **TcpServer - Edge Cases**
   - Test server with string address
   - Test server already listening
   - Test server error event
   - Test server close with error

6. **TcpTransport - Validation**
   - Test isValidAddress error catch

**Expected Coverage Gain:** 72.22% → 88%+ (16% increase)

#### 2.2 base-transport.ts Tests (8-10 tests)
**File:** `test/netron/transport/base-transport-advanced.spec.ts`

1. **BaseConnection - Reconnection**
   - Test scheduleReconnect logic
   - Test reconnection backoff calculation
   - Test max reconnection attempts
   - Test reconnect_failed event

2. **BaseConnection - Ping Error Handling**
   - Test sendPacket error during ping
   - Test pending pings rejection on cleanup

3. **BaseServer - Broadcast Error Handling**
   - Test broadcast with some connections failing
   - Test broadcastPacket with some connections failing
   - Test connection metrics tracking

4. **BaseTransport - Address Parsing Edge Cases**
   - Test IPv6 address parsing
   - Test Unix socket parsing
   - Test IPC address parsing
   - Test port validation (out of range)
   - Test malformed URL handling
   - Test default port handling

**Expected Coverage Gain:** 84.56% → 92%+ (8% increase)

---

### Phase 3: Polish Files (Est. 10-15 tests)
**Target: Bring websocket-transport.ts and transport-registry.ts to >90%**

#### 3.1 websocket-transport.ts Tests (5-7 tests)
**File:** `test/netron/transport/websocket-transport-edge-cases.spec.ts`

1. **WebSocketConnection - SSL/TLS**
   - Test WSS connection
   - Test certificate validation

2. **WebSocketServer - Upgrade Handling**
   - Test upgrade event edge cases
   - Test server close error handling

3. **WebSocketTransport - State Transitions**
   - Test all state transition edge cases

**Expected Coverage Gain:** 80.48% → 90%+ (10% increase)

#### 3.2 transport-registry.ts Tests (3-5 tests)
**File:** `test/netron/transport/transport-registry-edge-cases.spec.ts`

1. **Registry - Error Handling**
   - Test duplicate registration error
   - Test invalid protocol alias
   - Test default transport conflicts

**Expected Coverage Gain:** 85.45% → 92%+ (7% increase)

---

## Estimated Coverage Impact

### Before Implementation
| File | Current | Target | Gap |
|------|---------|--------|-----|
| transport-adapter.ts | 44.72% | 85% | 40.28% |
| unix-transport.ts | 59.2% | 85% | 25.8% |
| tcp-transport.ts | 72.22% | 85% | 12.78% |
| base-transport.ts | 84.56% | 85% | 0.44% |
| websocket-transport.ts | 80.48% | 85% | 4.52% |
| transport-registry.ts | 85.45% | 85% | 0% ✅ |

### After Implementation (Estimated)
| File | Estimated | Improvement |
|------|-----------|-------------|
| transport-adapter.ts | ~75-80% | +30-35% |
| unix-transport.ts | ~85-90% | +26-31% |
| tcp-transport.ts | ~88-92% | +16-20% |
| base-transport.ts | ~92-95% | +8-11% |
| websocket-transport.ts | ~90-92% | +10-12% |
| transport-registry.ts | ~92-95% | +7-10% |

**Overall Transport Coverage:** 70.23% → **~85-88%** ✅

---

## Test Implementation Guidelines

### 1. Test Organization
- Create new files for advanced/edge case tests
- Keep existing test files unchanged
- Use descriptive test suite names
- Group related tests in describe blocks

### 2. Test Patterns
```typescript
describe('Module - Feature', () => {
  describe('Specific Scenario', () => {
    it('should handle edge case X', async () => {
      // Arrange
      // Act
      // Assert
    });
  });
});
```

### 3. Coverage Verification
After each test file:
```bash
yarn test test/netron/transport/[new-file].spec.ts --coverage
```

Check coverage delta:
```bash
yarn test test/netron/transport --coverage --silent | grep "transport-adapter.ts"
```

### 4. Error Simulation Techniques
- Use mocks for native WebSocket
- Create invalid file descriptors for error paths
- Use short timeouts to trigger timeout paths
- Mock fs operations for permission errors
- Use process.platform checks for platform-specific tests

### 5. Platform-Specific Testing
```typescript
const isWindows = process.platform === 'win32';

describe('Platform-specific Tests', () => {
  if (isWindows) {
    it('should test Windows-specific behavior', () => {
      // Windows test
    });
  } else {
    it('should test Unix-specific behavior', () => {
      // Unix test
    });
  }
});
```

---

## Test Execution Plan

### Step 1: Create Test Files (Do NOT implement yet, just create structure)
1. `transport-adapter-advanced.spec.ts`
2. `named-pipe-transport.spec.ts`
3. `tcp-transport-advanced.spec.ts`
4. `base-transport-advanced.spec.ts`
5. `websocket-transport-edge-cases.spec.ts`
6. `transport-registry-edge-cases.spec.ts`

### Step 2: Implement Phase 1 (Critical - Priority 1)
- Focus on transport-adapter.ts
- Focus on unix-transport.ts
- Target: 70.23% → 78-80% overall

### Step 3: Implement Phase 2 (Medium - Priority 2)
- Focus on tcp-transport.ts
- Focus on base-transport.ts
- Target: 78-80% → 83-85% overall

### Step 4: Implement Phase 3 (Polish - Priority 3)
- Focus on websocket-transport.ts
- Focus on transport-registry.ts
- Target: 83-85% → 85-88% overall

### Step 5: Verification
- Run full transport test suite with coverage
- Verify >85% overall transport coverage
- Document any remaining gaps (acceptable if <5%)

---

## Success Criteria

1. ✅ Overall transport layer coverage >85%
2. ✅ No critical file below 75%
3. ✅ All error paths tested
4. ✅ All platform-specific code tested (where applicable)
5. ✅ All data type conversions tested
6. ✅ All connection lifecycle states tested

---

## Risk Assessment

### High Risk (Must Address)
- ❌ **transport-adapter.ts** at 44.72% - Core bridging layer
- ❌ **unix-transport.ts** at 59.2% - Critical IPC mechanism

### Medium Risk (Should Address)
- ⚠️ **tcp-transport.ts** at 72.22% - Primary distributed transport
- ⚠️ **websocket-transport.ts** at 80.48% - Close to target but has gaps

### Low Risk (Nice to Have)
- ✅ **base-transport.ts** at 84.56% - Already at target
- ✅ **transport-registry.ts** at 85.45% - Already exceeding target

---

## Estimated Effort

| Phase | Tests | Effort | Coverage Gain |
|-------|-------|--------|---------------|
| Phase 1 | 30-35 tests | 8-12 hours | +8-10% overall |
| Phase 2 | 15-20 tests | 5-8 hours | +5-7% overall |
| Phase 3 | 10-15 tests | 3-5 hours | +2-3% overall |
| **Total** | **55-70 tests** | **16-25 hours** | **+15-20%** |

---

## Notes for Implementation

1. **Do NOT create test files yet** - This is a strategy document only
2. **Mock carefully** - Native WebSocket and platform-specific APIs need proper mocking
3. **Platform tests** - Run on both Unix and Windows if possible
4. **Error injection** - Use timeouts, invalid data, and permission errors
5. **State coverage** - Test all ConnectionState transitions
6. **Metric tracking** - Verify metrics are updated correctly
7. **Cleanup** - Ensure proper resource cleanup in all tests
8. **Isolation** - Each test should be independent and repeatable

---

## Coverage Monitoring

### Before Starting
```bash
yarn test test/netron/transport --coverage --silent 2>&1 | grep "src/netron/transport"
```

### After Each Phase
```bash
# Phase 1
yarn test test/netron/transport --coverage --silent 2>&1 | grep "transport-adapter.ts\|unix-transport.ts"

# Phase 2
yarn test test/netron/transport --coverage --silent 2>&1 | grep "tcp-transport.ts\|base-transport.ts"

# Phase 3
yarn test test/netron/transport --coverage --silent 2>&1 | grep "websocket-transport.ts\|transport-registry.ts"
```

### Final Verification
```bash
yarn test test/netron/transport --coverage
```

Expected final output:
```
src/netron/transport           | >85%  | >80%  | >85%  | >85%  |
```

---

## Appendix: Uncovered Line Analysis

### transport-adapter.ts Detailed Line Analysis
- **Lines 62-84:** `binaryType` setter with validation - needs invalid type test
- **Lines 146-156:** ArrayBuffer/Uint8Array conversion in send - needs type variation tests
- **Lines 176-233:** NativeWebSocketWrapper complete class - needs WebSocket mock tests
- **Lines 247-274:** WebSocket detection and wrapping - needs factory method tests
- **Lines 280-370:** Full WebSocket wrapper implementation - needs full lifecycle tests

### unix-transport.ts Detailed Line Analysis
- **Lines 266-410:** NamedPipeTransport (Windows) - untested, needs Windows environment or mocks
- **Lines 129-130:** Timeout error in connect - needs forced timeout
- **Lines 176, 186, 199:** Error handling paths - needs error injection

### tcp-transport.ts Detailed Line Analysis
- **Lines 62, 75:** Socket option setters - needs option configuration tests
- **Lines 87-89:** CONNECTING state - needs pre-connect state test
- **Lines 159-162:** ArrayBuffer conversion - needs type variation tests
- **Lines 204-244:** Reconnection logic - completely untested, needs reconnect scenario
- **Lines 321-326:** Already listening edge case - needs double listen test

### base-transport.ts Detailed Line Analysis
- **Lines 218-227:** Reconnection scheduling and ping errors - needs reconnect tests
- **Lines 247-253:** Cleanup with pending pings - needs cleanup test during active ping
- **Lines 316, 328, 338:** Broadcast error handling - needs failing connection tests
- **Lines 372-460:** URL parsing edge cases - needs malformed URL tests

---

**Document Version:** 1.0
**Last Updated:** 2025-10-09
**Status:** Ready for Implementation
