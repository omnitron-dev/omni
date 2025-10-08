# HTTP Peer Integration Tests - Status Report

**Date:** 2025-10-08
**Status:** 🔧 In Progress - Partial Fixes Completed

## Summary

Investigated and partially fixed issues in `test/netron/transport/http/peer-integration.spec.ts`. Multiple root causes identified and some resolved.

## Issues Identified and Fixed

### ✅ 1. Service Discovery Timeout (FIXED)
**Problem:** `HttpConnection` automatically triggers service discovery on initialization, causing 30-second timeouts when server not ready or unavailable.

**Root Cause:**
- `initializeConnection()` calls `discoverServices()` in `setImmediate`
- Discovery endpoint `/netron/discovery` may not be ready when connection is created
- Default HTTP timeout is 30 seconds

**Solution:**
- Added `discovery?: boolean` option to `TransportOptions` (default: true)
- Updated `HttpConnection.initializeConnection()` to respect the option
- Updated `peer-integration.spec.ts` to disable auto-discovery: `new HttpConnection(baseUrl, { discovery: false })`

**Files Modified:**
- `src/netron/transport/types.ts` - Added discovery option
- `src/netron/transport/http/connection.ts` - Respect discovery option
- `test/netron/transport/http/peer-integration.spec.ts` - Disable discovery in tests

### ✅ 2. Service Registration Issue (FIXED)
**Problem:** `query-interface` endpoint returned 404 "Service not found" even though service was exposed.

**Root Cause:**
- Services registered in `HttpServer.services` Map by simple name (`calculator`)
- Definitions stored in `Netron.services` Map by qualified name (`calculator@1.0.0`)
- `handleQueryInterfaceRequest()` called `getDefinitionByServiceName()` which looked in wrong Map

**Solution:**
- Added `stub` reference to `ServiceDescriptor` interface
- Updated `registerPeerServices()` to store stub reference in descriptor
- Updated `handleQueryInterfaceRequest()` to get definition from `localService.stub.definition`

**Files Modified:**
- `src/netron/transport/http/server.ts`
  - Line 62: Added `stub?: any` to ServiceDescriptor
  - Line 252: Store stub reference in descriptor
  - Lines 871-877: Get definition from stub instead of getDefinitionByServiceName()

### ✅ 3. Query Interface Response Format (FIXED)
**Problem:** Client expected `response.data` to contain full Definition, but server returned only `definition.meta`.

**Solution:**
- Changed server to return full definition object: `data: filteredDefinition` instead of `data: filteredDefinition.meta`
- Updated client to read from `response.data` in correct format

**Files Modified:**
- `src/netron/transport/http/server.ts` - Line 914: Return full definition
- `src/netron/transport/http/peer.ts` - Lines 582-594: Read from response.data

### ✅ 4. HTTP Invoke Endpoint Format (VERIFIED)
**Problem:** Understanding of HTTP request message format

**Verification:**
Created test with correct format:
```typescript
{
  id: string,
  version: '2.0',
  timestamp: number,
  service: string,
  method: string,
  input: any  // NOT 'args'!
}
```

Direct HTTP call to `/netron/invoke` **works correctly** and returns expected result.

## Remaining Issues

### 🔧 1. Peer Method Call Hangs (IN PROGRESS)
**Problem:** `httpPeer.queryInterface().method()` calls hang and timeout after 30 seconds.

**Symptoms:**
- Direct HTTP POST to `/netron/invoke` with correct format → ✅ Works (returns 200, correct data)
- Call through `HttpRemotePeer.call()` → ❌ Hangs (30s timeout)

**Investigation Needed:**
1. Add logging to `HttpRemotePeer.sendRequestMessage()` to see exact message being sent
2. Add logging to `HttpServer.handleInvocationRequest()` to see if request arrives
3. Check if problem is in request sending or response receiving
4. Verify `getServiceNameFromDefId()` returns correct service name

**Hypothesis:**
- Possible issue with service name extraction from definition ID
- OR response format mismatch causing client to wait indefinitely
- OR connection/request timeout configuration issue

## Test Results

**Current State:**
- Setup/teardown: ✅ Works
- Service exposure: ✅ Works
- HTTP discovery endpoint: ✅ Works
- HTTP query-interface endpoint: ✅ Works
- HTTP invoke endpoint (direct): ✅ Works
- Peer method calls: ❌ Hangs

**Test Count:**
- Total tests: 18
- Passing: ~3 (initialization tests)
- Failing: ~15 (all method invocation tests timeout)

## Architecture Notes

### Security Considerations
The user emphasized that Netron's security architecture allows returning partial definitions based on authorization. The current implementation supports this:

1. **Authorization Filter Point:**
   `handleQueryInterfaceRequest()` checks for `authorizationManager` and filters definition:
   ```typescript
   if (authzManager && authContext) {
     const filteredMeta = authzManager.filterDefinition(serviceName, definition.meta, authContext);
     filteredDefinition = { ...definition, meta: filteredMeta };
   }
   ```

2. **Current State:** Authorization manager support exists but not fully tested in integration tests.

### Transport Options Discovery Default
Default behavior changed:
- **Before:** Auto-discovery always enabled (caused test issues)
- **After:** Auto-discovery enabled by default, but can be disabled with `{ discovery: false }`
- **Impact:** Tests run faster, production apps can still benefit from auto-discovery

## Next Steps

1. **Immediate (High Priority):**
   - [ ] Add detailed logging to `HttpRemotePeer` and `HttpServer` to trace request flow
   - [ ] Identify exact point where peer method calls hang
   - [ ] Fix the hanging issue

2. **Short Term:**
   - [ ] Run all 18 tests to completion
   - [ ] Ensure 100% pass rate
   - [ ] Verify authorization filtering works correctly

3. **Long Term:**
   - [ ] Add integration tests for authorization scenarios
   - [ ] Performance optimization for service discovery
   - [ ] Consider WebSocket fallback for real-time features

## Files Modified Summary

```
src/netron/transport/types.ts
  + Added discovery?: boolean option

src/netron/transport/http/connection.ts
  ~ Modified initializeConnection() to check discovery option

src/netron/transport/http/server.ts
  ~ Modified ServiceDescriptor interface (added stub)
  ~ Modified registerPeerServices() (store stub)
  ~ Modified handleQueryInterfaceRequest() (use stub.definition)
  ~ Modified query-interface response (return full definition)

src/netron/transport/http/peer.ts
  ~ Modified queryInterfaceRemote() response handling (read from data)

test/netron/transport/http/peer-integration.spec.ts
  ~ Modified beforeEach() (disable discovery)
```

## Debugging Commands

```bash
# Run single test with verbose output
npm test -- test/netron/transport/http/peer-integration.spec.ts -t "should initialize" --testTimeout=5000

# Run with open handle detection
npm test -- test/netron/transport/http/peer-integration.spec.ts --detectOpenHandles

# Run minimal subset
npm test -- test/netron/transport/http/peer-integration.spec.ts -t "Peer Initialization"
```

## Conclusion

Significant progress made on HTTP peer integration:
- ✅ 4 major issues identified and fixed
- ✅ Basic server functionality verified
- 🔧 1 critical issue remains (peer method calls hang)

The remaining issue appears to be in the request/response flow between `HttpRemotePeer` and `HttpServer`. Further investigation with detailed logging needed to identify the exact failure point.
