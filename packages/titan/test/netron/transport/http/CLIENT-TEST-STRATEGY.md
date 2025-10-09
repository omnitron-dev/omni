# HTTP Client Test Strategy

## Current Coverage Status
- **Current Coverage**: 8.51% (17/200 lines)
- **Target Coverage**: >90% (180+ lines)
- **Lines to Cover**: 163 lines
- **Uncovered Range**: Lines 41-190

## Code Analysis

### File Structure
The `HttpTransportClient` class (`/Users/taaliman/projects/omnitron-dev/omni/packages/titan/src/netron/transport/http/client.ts`) contains:

**Methods:**
1. `constructor()` - Lines 28-35 (partially covered)
2. `initialize()` - Lines 40-49 (UNCOVERED)
3. `invoke()` - Lines 54-97 (UNCOVERED)
4. `sendRequest()` - Lines 102-172 (UNCOVERED)
5. `close()` - Lines 177-184 (UNCOVERED)
6. `getMetrics()` - Lines 189-196 (UNCOVERED)

**Dependencies:**
- `HttpConnection` - Creates background service discovery (lines 77-87 in connection.ts)
- `HttpRemotePeer` - Full Netron integration with service proxies
- `createRequestMessage()` - Helper from types.ts
- `NetronErrors.invalidResponse()` - Error handling

## Known Issue: Test Hanging Problem

### Root Cause
HttpConnection automatically starts background service discovery in `setImmediate()` callback (connection.ts:77-87):
```typescript
setImmediate(() => {
  this.emit('connect');

  const discoveryEnabled = this.options.discovery !== false; // default true
  if (discoveryEnabled) {
    this.discoverServices().catch((err) => {
      console.warn('Failed to pre-load service discovery:', err);
    });
  }
});
```

This creates pending HTTP requests that keep Jest alive if:
- Tests don't properly await completion
- Mocked fetch doesn't resolve
- Connection isn't properly closed

### Workarounds

#### Option 1: Disable Discovery (Recommended for Client Tests)
```typescript
const client = new HttpTransportClient(baseUrl, undefined, {
  discovery: false  // Prevent background discovery
});
```

#### Option 2: Mock Fetch Properly
Ensure all fetch calls resolve quickly:
```typescript
mockFetch.mockResolvedValue({
  ok: true,
  status: 200,
  headers: { get: jest.fn() },
  json: jest.fn().mockResolvedValue({ services: {} })
});
```

#### Option 3: Proper Cleanup
Always close connections and wait for pending operations:
```typescript
afterEach(async () => {
  if (client) {
    await client.close();
  }
  // Wait for setImmediate callbacks
  await new Promise(resolve => setImmediate(resolve));
});
```

## Detailed Coverage Analysis

### 1. Constructor (Lines 28-35)
**Status**: Partially covered by existing connection tests
**Uncovered Lines**: None critical
**Coverage**: ~90%

### 2. initialize() Method (Lines 40-49)
**Status**: UNCOVERED
**Complexity**: Medium
**Lines**: 41-49

**Code Path Analysis:**
```typescript
40: async initialize(): Promise<void> {
41:   if (!this.connection) {                    // Branch 1: No connection
42:     this.connection = new HttpConnection(...);
43:
44:     if (this.netron) {                        // Branch 2: With Netron
45:       this.peer = new HttpRemotePeer(...);
46:       await this.peer.init(true, ...);
47:     }
48:   }
49: }
```

**Test Cases Needed:**
1. **Test: Should create connection on first call**
   - Call initialize() without netron
   - Verify connection created
   - Verify peer not created

2. **Test: Should create connection and peer with netron**
   - Provide mock netron instance
   - Call initialize()
   - Verify connection created
   - Verify peer created and initialized

3. **Test: Should be idempotent (multiple calls)**
   - Call initialize() twice
   - Verify connection created only once

4. **Test: Should normalize base URL (trailing slash)**
   - Create client with trailing slash URL
   - Call initialize()
   - Verify connection has normalized URL

**Estimated Tests**: 4
**Lines Covered**: 41-49 (9 lines)

### 3. invoke() Method (Lines 54-97)
**Status**: UNCOVERED
**Complexity**: High
**Lines**: 54-97

**Code Path Analysis:**
```typescript
54: async invoke(service, method, args, options?) {
63:   await this.initialize();                    // Path 1: Initialize
64:
66:   if (this.peer) {                           // Path 2: Use peer
68:     const serviceDef = await this.peer.queryInterface(service);
69:     if (serviceDef && typeof (serviceDef as any)[method] === 'function') {
71:       return (serviceDef as any)[method](args[0]);
72:     }
73:   }
74:
76:   if (this.connection) {                     // Path 3: Use connection
77:     const serviceProxy = await this.connection.queryInterface(service);
78:     if (serviceProxy && typeof serviceProxy[method] === 'function') {
79:       return serviceProxy[method](args[0]);
80:     }
81:   }
82:
84:   const message = createRequestMessage(...);  // Path 4: Direct HTTP
89:   const response = await this.sendRequest(message);
90:
91:   if (!response.success) {                   // Error handling
92:     const errorMsg = response.error?.message || 'Method invocation failed';
93:     throw NetronErrors.invalidResponse(service, method, { error: response.error, message: errorMsg });
94:   }
95:
96:   return response.data;
97: }
```

**Test Cases Needed:**

1. **Test: Should invoke via peer when available**
   - Setup: Client with netron and peer
   - Mock peer.queryInterface() to return service with method
   - Call invoke('Service@1.0.0', 'method', [arg])
   - Verify peer method called with correct args
   - Verify result returned

2. **Test: Should fallback to connection when peer unavailable**
   - Setup: Client without netron (no peer)
   - Mock connection.queryInterface() to return service proxy
   - Call invoke('Service@1.0.0', 'method', [arg])
   - Verify connection proxy method called
   - Verify result returned

3. **Test: Should fallback to direct HTTP when peer method not found**
   - Setup: Client with peer
   - Mock peer.queryInterface() to return service without method
   - Mock sendRequest() to return success response
   - Call invoke('Service@1.0.0', 'missingMethod', [arg])
   - Verify sendRequest() called
   - Verify response data returned

4. **Test: Should use direct HTTP when no peer or connection proxy**
   - Setup: Client without netron
   - Mock connection.queryInterface() to return null
   - Mock sendRequest() to return success response
   - Call invoke('Service@1.0.0', 'method', [arg])
   - Verify sendRequest() called with correct message
   - Verify result returned

5. **Test: Should pass context and hints to request**
   - Setup: Client ready for direct HTTP
   - Call invoke with context and hints
   - Verify message created with context and hints
   - Verify sendRequest() called with enriched message

6. **Test: Should throw error on failed response**
   - Setup: Mock sendRequest() to return error response
   - Call invoke('Service@1.0.0', 'method', [arg])
   - Expect NetronErrors.invalidResponse() thrown
   - Verify error contains service, method, and error details

7. **Test: Should handle missing error message in response**
   - Setup: Mock sendRequest() to return error without message
   - Call invoke()
   - Verify default error message used

**Estimated Tests**: 7
**Lines Covered**: 54-97 (44 lines, including branches)

### 4. sendRequest() Method (Lines 102-172)
**Status**: UNCOVERED
**Complexity**: High
**Lines**: 102-172

**Code Path Analysis:**
```typescript
102: private async sendRequest(message: HttpRequestMessage): Promise<HttpResponseMessage> {
103:   const url = `${this.baseUrl}/netron/invoke`;
104:   const timeout = message.hints?.timeout || this.options?.timeout || 30000;
105:
106:   const controller = new AbortController();
107:   const timeoutId = setTimeout(() => controller.abort(), timeout);
108:
109:   try {
110:     const response = await fetch(url, {         // Main request
111-120:     ...
121:     });
122:
123:     clearTimeout(timeoutId);
124:
125:     if (!response.ok) {                         // HTTP error handling
126:       try {
127:         const errorData = await response.json(); // Try parse error
128:         return errorData;
129:       } catch {
130:         return {                                // Generic error response
131-140:         };
141:       }
142:     }
143:
144:     return await response.json();               // Success response
145:   } catch (error: any) {
146:     clearTimeout(timeoutId);
147:
148:     if (error.name === 'AbortError') {          // Timeout error
149-158:     }
159:
160:     return {                                    // Network error
161-170:     };
171:   }
172: }
```

**Test Cases Needed:**

1. **Test: Should send POST request with correct headers**
   - Mock fetch
   - Call sendRequest()
   - Verify fetch called with:
     - POST method
     - Content-Type: application/json
     - X-Netron-Version: 2.0
     - Custom headers from options

2. **Test: Should use message hint timeout**
   - Create message with hints.timeout = 5000
   - Mock fetch with delay
   - Verify timeout set to 5000ms

3. **Test: Should use options timeout**
   - Create client with options.timeout = 10000
   - Create message without hints.timeout
   - Verify timeout set to 10000ms

4. **Test: Should use default timeout (30000ms)**
   - Create client without timeout option
   - Create message without hints.timeout
   - Verify timeout set to 30000ms

5. **Test: Should return parsed JSON on success**
   - Mock fetch to return ok response with JSON
   - Call sendRequest()
   - Verify response parsed and returned
   - Verify timeout cleared

6. **Test: Should handle HTTP error with JSON body**
   - Mock fetch to return status 400 with error JSON
   - Call sendRequest()
   - Verify error JSON parsed and returned
   - Verify timeout cleared

7. **Test: Should handle HTTP error without JSON body**
   - Mock fetch to return status 500, JSON parse fails
   - Call sendRequest()
   - Verify generic error response with HTTP status
   - Verify error has: code: 'HTTP_ERROR', message includes status

8. **Test: Should handle timeout (AbortError)**
   - Mock fetch to throw AbortError
   - Call sendRequest()
   - Verify response has:
     - success: false
     - error.code: 'TIMEOUT'
     - error.message includes timeout duration
   - Verify timeout cleared

9. **Test: Should handle network error**
   - Mock fetch to throw Error('Network failed')
   - Call sendRequest()
   - Verify response has:
     - success: false
     - error.code: 'NETWORK_ERROR'
     - error.message includes error message
   - Verify timeout cleared

10. **Test: Should abort request on timeout**
    - Mock fetch with delay longer than timeout
    - Set short timeout
    - Verify AbortController.abort() called
    - Verify timeout error returned

**Estimated Tests**: 10
**Lines Covered**: 102-172 (71 lines, including all branches)

### 5. close() Method (Lines 177-184)
**Status**: UNCOVERED
**Complexity**: Low
**Lines**: 177-184

**Code Path Analysis:**
```typescript
177: async close(): Promise<void> {
178:   if (this.peer) {
179:     await this.peer.close();
180:   }
181:   if (this.connection) {
182:     await this.connection.close();
183:   }
184: }
```

**Test Cases Needed:**

1. **Test: Should close peer and connection**
   - Setup: Client with peer and connection
   - Call close()
   - Verify peer.close() called
   - Verify connection.close() called

2. **Test: Should close connection without peer**
   - Setup: Client without netron (no peer)
   - Call close()
   - Verify connection.close() called
   - Verify no error thrown

3. **Test: Should be idempotent**
   - Call close() twice
   - Verify no errors thrown
   - Verify cleanup happens once

4. **Test: Should handle uninitialized client**
   - Create client but don't call initialize()
   - Call close()
   - Verify no errors thrown

**Estimated Tests**: 4
**Lines Covered**: 177-184 (8 lines)

### 6. getMetrics() Method (Lines 189-196)
**Status**: UNCOVERED
**Complexity**: Low
**Lines**: 189-196

**Code Path Analysis:**
```typescript
189: getMetrics(): any {
190:   return {
191:     baseUrl: this.baseUrl,
192:     connected: !!this.connection,
193:     hasPeer: !!this.peer,
194:     connectionMetrics: this.connection?.getMetrics()
195:   };
196: }
```

**Test Cases Needed:**

1. **Test: Should return metrics before initialization**
   - Create client without initialization
   - Call getMetrics()
   - Verify:
     - baseUrl: set
     - connected: false
     - hasPeer: false
     - connectionMetrics: undefined

2. **Test: Should return metrics after initialization without netron**
   - Initialize client without netron
   - Call getMetrics()
   - Verify:
     - baseUrl: set
     - connected: true
     - hasPeer: false
     - connectionMetrics: present (from connection)

3. **Test: Should return metrics with peer**
   - Initialize client with netron (creates peer)
   - Call getMetrics()
   - Verify:
     - baseUrl: set
     - connected: true
     - hasPeer: true
     - connectionMetrics: present

4. **Test: Should include connection metrics**
   - Initialize client
   - Mock connection.getMetrics() to return specific data
   - Call getMetrics()
   - Verify connectionMetrics contains mocked data

**Estimated Tests**: 4
**Lines Covered**: 189-196 (8 lines)

## Test Organization Strategy

### Test File Structure
```
http-transport-client.spec.ts
├── Constructor & Initialization
│   ├── Constructor tests (4 tests)
│   └── initialize() method tests (4 tests)
├── Method Invocation
│   ├── invoke() with peer (2 tests)
│   ├── invoke() with connection (2 tests)
│   ├── invoke() direct HTTP (3 tests)
│   └── invoke() error handling (2 tests)
├── HTTP Communication
│   ├── sendRequest() success cases (5 tests)
│   ├── sendRequest() error cases (5 tests)
│   └── Timeout handling (2 tests)
├── Lifecycle Management
│   ├── close() tests (4 tests)
│   └── Resource cleanup (2 tests)
└── Metrics & Observability
    └── getMetrics() tests (4 tests)
```

### Mock Strategy

#### Minimal Mocks (Recommended)
```typescript
// Disable discovery to prevent hanging
const clientOptions = { discovery: false };

// Mock only fetch for sendRequest tests
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock netron for peer tests
const mockNetron = {
  logger: { child: jest.fn().mockReturnThis(), info: jest.fn() }
};
```

#### Full Mocks (When Needed)
```typescript
// Mock HttpConnection
jest.mock('../../../../src/netron/transport/http/connection.js', () => ({
  HttpConnection: jest.fn().mockImplementation(() => ({
    id: 'mock-connection',
    state: ConnectionState.CONNECTED,
    send: jest.fn(),
    close: jest.fn(),
    queryInterface: jest.fn(),
    getMetrics: jest.fn().mockReturnValue({})
  }))
}));

// Mock HttpRemotePeer
jest.mock('../../../../src/netron/transport/http/peer.js', () => ({
  HttpRemotePeer: jest.fn().mockImplementation(() => ({
    init: jest.fn(),
    close: jest.fn(),
    queryInterface: jest.fn()
  }))
}));
```

## Summary

### Coverage Goals
| Component | Current | Target | Tests Needed |
|-----------|---------|--------|--------------|
| Constructor | 90% | 95% | 2 |
| initialize() | 0% | 100% | 4 |
| invoke() | 0% | 95% | 7 |
| sendRequest() | 0% | 100% | 10 |
| close() | 0% | 100% | 4 |
| getMetrics() | 0% | 100% | 4 |
| **TOTAL** | **8.51%** | **>90%** | **31 tests** |

### Test Execution Plan

**Phase 1: Foundation (8 tests)**
- Constructor tests (2)
- initialize() tests (4)
- getMetrics() basic tests (2)

**Phase 2: Core Functionality (12 tests)**
- invoke() with peer (2)
- invoke() with connection (2)
- invoke() direct HTTP (3)
- sendRequest() success cases (5)

**Phase 3: Error Handling (7 tests)**
- invoke() error handling (2)
- sendRequest() error cases (5)

**Phase 4: Lifecycle & Edge Cases (4 tests)**
- close() tests (4)
- Timeout handling from Phase 2

### Key Testing Principles

1. **Prevent Hanging Tests**
   - Always set `discovery: false` in client options
   - Ensure all mocks resolve quickly
   - Proper cleanup in afterEach

2. **Isolation**
   - Test each code path independently
   - Use minimal mocks where possible
   - Mock only external dependencies

3. **Coverage Focus**
   - Target uncovered lines explicitly
   - Test all branches and error paths
   - Verify error messages and codes

4. **Real-World Scenarios**
   - Test with and without netron
   - Test with context and hints
   - Test error conditions and timeouts

### Expected Coverage After Implementation
With 31 tests covering all 6 methods:
- **Statements**: >90%
- **Branches**: >85%
- **Functions**: 100%
- **Lines**: >90%

### Risk Areas
1. **Peer interaction**: Complex integration with HttpRemotePeer
2. **Error handling**: Multiple fallback paths need careful testing
3. **Timeout logic**: AbortController and timer cleanup
4. **Async cleanup**: Proper awaiting of close operations

### Next Steps
1. **Review & Approve** this strategy
2. **Implement Phase 1** (Foundation - 8 tests)
3. **Verify coverage increase** to ~40-50%
4. **Implement Phase 2** (Core - 12 tests)
5. **Verify coverage increase** to ~70-80%
6. **Implement Phase 3 & 4** (Remaining tests)
7. **Verify final coverage** >90%
