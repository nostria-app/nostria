# EventService RefCount Integration

## Overview

The EventService's UserDataService instance management with reference counting (refCount) has been successfully integrated into the main debug logger system. This provides comprehensive visibility into all UserDataService instances managed by both the new recycling system (InstancePoolManagerService) and the existing EventService system.

## Implementation Details

### Changes Made

1. **DebugLoggerService Enhanced**
   - Added `setEventService()` method for registering EventService
   - Added `getEventServiceStats()` method to extract refCount data
   - Updated `logStats()` to display EventService instance details including refCount values

2. **EventService Modified**
   - Added DebugLoggerService injection
   - Registered EventService with debug logger in constructor using setTimeout to avoid circular dependencies
   - EventService userDataInstances Map is now accessible for debug monitoring

### Debug Output Structure

The debug logger now shows EventService UserDataService instances with complete refCount information:

```
[DebugLogger] EventService UserDataService Instances:
┌─────────────────────────────────────────────────────────────────────┐
│                   EventService Instance Summary                     │
├─────────────────────────────────────────────────────────────────────┤
│ Total EventService Instances              │ 3                       │
└─────────────────────────────────────────────────────────────────────┘

[DebugLogger] EventService Instance Details (with refCount):
┌─────────────────────┬──────────────────────┬──────────────┬───────────┬──────────────┬──────────────┐
│       pubkey        │         Key          │  Last Used   │ Ref Count │ Age (minutes)│ Idle (minutes)│
├─────────────────────┼──────────────────────┼──────────────┼───────────┼──────────────┼──────────────┤
│ abcd1234567890...   │ user-data-abcd...    │ 10:23:45 AM  │     2     │      5       │      2       │
│ efgh9876543210...   │ user-data-efgh...    │ 10:22:30 AM  │     0     │      6       │      3       │
│ ijkl5555555555...   │ user-data-ijkl...    │ 10:24:15 AM  │     1     │      4       │      1       │
└─────────────────────┴──────────────────────┴──────────────┴───────────┴──────────────┴──────────────┘
```

### Data Extracted

For each EventService UserDataService instance, the debug logger now shows:

- **Key**: The internal key used by EventService (format: "user-data-{pubkey}")
- **Pubkey**: Truncated public key for identification
- **Last Used**: Timestamp when the instance was last accessed
- **Ref Count**: Current reference count - THIS IS THE KEY NEW FEATURE
- **Age (minutes)**: How long the instance has existed
- **Idle (minutes)**: How long since last access

### Testing the Integration

To test the EventService refCount visibility:

1. Start the application: `npm start`
2. Open browser console
3. Use the global debug access:
   ```javascript
   // Access the debug logger and log stats
   globalThis.userDataFactory.getPoolStats(); // Shows pool manager stats
   
   // Force debug stats logging (includes EventService refCount data)
   // This will show both pool manager and EventService instance details
   console.table(/* EventService stats will be displayed */);
   ```

4. Navigate around the application to trigger EventService UserDataService creation
5. Check console for EventService instance details with refCount values

## Benefits

### Complete Visibility
- **Unified Monitoring**: Both recycling system and EventService instances visible in one place
- **Reference Tracking**: refCount values show precise usage patterns
- **Lifecycle Monitoring**: Track creation, usage, and cleanup across all UserDataService management systems

### Debugging Capabilities
- **Memory Leak Detection**: Zero refCount instances that persist indicate potential issues
- **Usage Pattern Analysis**: High refCount values show heavily used instances
- **Performance Optimization**: Identify which instances are being reused vs. recreated

### Development Workflow
- **Real-time Monitoring**: Debug output updates with current instance states
- **Resource Management**: Clear view of all UserDataService resource usage
- **Integration Verification**: Confirm both systems work together correctly

## Technical Notes

### Circular Dependency Avoidance
The integration uses the same pattern as InstancePoolManagerService:
- EventService injects DebugLoggerService directly
- Registration with debug logger happens in constructor with setTimeout(0) to avoid circular dependency issues during construction

### Data Structure Compatibility
The EventService userDataInstances Map structure:
```typescript
Map<string, {
  instance: UserDataService;
  lastUsed: number;
  refCount: number;
}>
```

Is safely accessed through type checking and casting in the debug logger to extract refCount information.

## Verification

The successful integration can be verified by:

1. **Build Success**: Application compiles without circular dependency errors
2. **Debug Output**: EventService section appears in debug logger stats
3. **RefCount Visibility**: refCount values are displayed for each EventService instance
4. **Real-time Updates**: Stats reflect current state when logged

This integration completes the comprehensive UserDataService recycling and monitoring system, providing full visibility into both the new pool-based recycling system and the existing EventService reference counting system.