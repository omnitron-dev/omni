# Circuit Breaker

`src/circuit-breaker-wrapper.ts`:```
import CircuitBreaker from 'opossum';

type RemoteCall = (...args: any[]) => Promise<any>;

export class CircuitBreakerWrapper {
  private breaker: CircuitBreaker;

  constructor(remoteCall: RemoteCall, options?: CircuitBreaker.Options) {
    this.breaker = new CircuitBreaker(remoteCall, {
      timeout: 5000, // timeout before call timeout triggers
      errorThresholdPercentage: 50, // error percentage before breaker opens
      resetTimeout: 10000, // wait time before restoring calls
      ...options,
    });

    this.breaker.on('open', () => {
      console.warn('Circuit breaker opened: remote call disabled temporarily.');
    });

    this.breaker.on('halfOpen', () => {
      console.info('Circuit breaker half-open: testing remote call.');
    });

    this.breaker.on('close', () => {
      console.info('Circuit breaker closed: remote call restored.');
    });
  }

  call(...args: any[]) {
    return this.breaker.fire(...args);
  }
}
```

`src/remote-peer.ts`:
```
import { CircuitBreakerWrapper } from './circuit-breaker-wrapper';

// inside RemotePeer constructor add:
private breakers = new Map<string, CircuitBreakerWrapper>();

// method for creating or getting CircuitBreaker
private getCircuitBreaker(methodName: string, fn: (...args: any[]) => Promise<any>) {
  if (!this.breakers.has(methodName)) {
    const breaker = new CircuitBreakerWrapper(fn);
    this.breakers.set(methodName, breaker);
  }
  return this.breakers.get(methodName)!;
}

// Updated methods with circuit breaker
get(defId: string, name: string) {
  const key = `get:${defId}:${name}`;
  return this.getCircuitBreaker(key, () => this.sendRequestWrapper(TYPE_GET, [defId, name])).call();
}

set(defId: string, name: string, value: any) {
  const key = `set:${defId}:${name}`;
  return this.getCircuitBreaker(key, () => this.sendRequestWrapper(TYPE_SET, [defId, name, value])).call();
}

call(defId: string, method: string, args: any[]) {
  const key = `call:${defId}:${method}`;
  return this.getCircuitBreaker(key, () => this.sendRequestWrapper(TYPE_CALL, [defId, method, ...args])).call();
}

runTask(name: string, ...args: any[]) {
  const key = `task:${name}`;
  return this.getCircuitBreaker(key, () => this.sendRequestWrapper(TYPE_TASK, [name, ...args])).call();
}

// Create helper method sendRequestWrapper
private sendRequestWrapper(type: PacketType, data: any) {
  return new Promise<any>((resolve, reject) => {
    this.sendRequest(
      type,
      data,
      (result) => resolve(result),
      (error) => reject(error)
    ).catch(reject);
  });
}
```

# zod paramenters validation

...

# examples

need many many examples