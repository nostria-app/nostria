# User Data / Relay Instance Lifecycle Management

This document explains the improved lifecycle management for `UserDataService` and `UserRelayService` instances.

## Goals
- Prevent unbounded growth of websocket connections.
- Recycle per-user services quickly after use (JIT access pattern).
- Keep data cached in IndexedDB so re-instantiating is cheap.
- Provide deterministic release semantics for components / services.

## Key Mechanisms

### 1. Instance Pool Manager
File: `src/app/services/instance-pool-manager.service.ts`

Enhancements:
- Added `refCount` to each `InstancePoolEntry`.
- `getOrCreateInstance(pubkey)` always reuses existing instance and increments `refCount`.
- New `releaseInstance(pubkey)` decrements `refCount` and schedules deferred destruction after a configurable grace period (`destructionGracePeriodMs`, default 1500ms). If the instance is reused before the timer fires, the destruction is canceled.
- Stats include `refCount` per instance.
- Idempotent destroy guards prevent double WebSocket closes (which previously caused "WebSocket is already in CLOSING or CLOSED state" console noise).

### 2. On-Demand Access
File: `src/app/services/on-demand-user-data.service.ts`

Provides helper methods (`getProfile`, `getProfiles`, `getEvent`) that:
1. Acquire pooled instance.
2. Execute required operation.
3. Auto-release instance so sockets are freed ASAP.

### 3. Refactoring Path (Pending)
`EventService` currently maintains an internal map of `UserDataService` instances with its own ref tracking. This should be removed in favor of the central pool + on-demand service (see TODO below).

## Usage Guidelines
- For one-off reads (profiles, single events) use `OnDemandUserDataService`.
- For streaming / longer operations: manually acquire via `UserDataFactoryService.create(pubkey)` then later call `InstancePoolManager.releaseInstance(pubkey)` when finished (e.g. after subscription closes).
- Do not retain direct references indefinitely inside components; always release on `ngOnDestroy`.

## Example (Manual Acquire / Release)
```ts
const pool = inject(InstancePoolManagerService);
const factory = inject(UserDataFactoryService);

async function loadUser(pubkey: string) {
  const uds = await factory.create(pubkey);
  try {
    return await uds.getProfile(pubkey);
  } finally {
    await pool.releaseInstance(pubkey);
  }
}
```

## Debugging
Global debugging can be enabled through `UserDataFactoryService.enableGlobalAccess()` which exposes:
```js
globalThis.userDataFactory.getPoolStats()
```
Add similar exposure for the pool manager if needed.

## TODO / Next Steps
- Remove manual map logic from `EventService` and delegate to pool.
- Update components (`user-profile`, etc.) to rely on on-demand service.
- Add automated tests for ref counting behavior.
- Consider adaptive `maxPoolSize` based on device memory heuristics.

## Rationale
Deferred destruction (grace period) still keeps socket count low while smoothing out rapid sequences of acquire/release (e.g. when UI renders multiple dependent computations), avoiding redundant connect/close churn and related warnings.

