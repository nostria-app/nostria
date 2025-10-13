# UserDataService Recycling System

## Overview

The UserDataService recycling system is a comprehensive solution to prevent memory leaks and resource accumulation by automatically managing the lifecycle of UserDataService instances. Each UserDataService holds a UserRelayService instance, which can consume significant resources if not properly managed.

## Problem Solved

Before this implementation:
- UserDataService instances were created on-demand but never destroyed
- Each instance held onto UserRelayService connections indefinitely
- Memory usage grew continuously as users navigated the app
- No mechanism existed to recycle or reuse instances

## Architecture

### Core Components

1. **InstancePoolManagerService** - Central manager for instance lifecycle
2. **UserDataFactoryService** - Enhanced to use pooling and recycling
3. **UserDataService** - Enhanced with usage tracking and smart idle detection
4. **DebugLoggerService** - Extended to show pool statistics

### Key Features

#### 1. Instance Pool Management
- Maximum pool size limit (default: 10 instances)
- Automatic eviction of least-recently-used instances
- Smart reuse of existing instances when appropriate

#### 2. Automatic Cleanup
- Periodic cleanup every 30 seconds (configurable)
- Idle timeout of 5 minutes (configurable)
- Background monitoring without blocking UI

#### 3. Usage Tracking
- Last access time tracking
- Access count monitoring
- Smart idle detection based on both UserDataService and UserRelayService state

#### 4. Debug Integration
- Real-time pool statistics
- Detailed instance lifecycle logging
- Integration with existing debug infrastructure

## Configuration

### Default Settings
```typescript
{
  maxPoolSize: 10,              // Maximum instances in pool
  idleTimeoutMs: 5 * 60 * 1000, // 5 minutes idle timeout
  cleanupIntervalMs: 30 * 1000, // 30 seconds cleanup interval
  reuseIdleTimeMs: 60 * 1000,   // 1 minute before reuse
  aggressiveCleanup: true       // Enable aggressive cleanup
}
```

### Runtime Configuration
You can update configuration at runtime:
```javascript
// In browser console
globalThis.userDataFactory.updatePoolConfig({
  maxPoolSize: 15,
  idleTimeoutMs: 10 * 60 * 1000 // 10 minutes
});
```

## Usage

### Automatic Operation
The recycling system operates automatically once initialized:
- Instances are created on-demand through the factory
- Existing instances are reused when possible
- Idle instances are automatically destroyed
- Pool size is maintained within configured limits

### Manual Controls (Debug/Testing)
Available through `globalThis.userDataFactory`:

```javascript
// Get current pool statistics
globalThis.userDataFactory.getPoolStats()

// Manually trigger cleanup
globalThis.userDataFactory.manualCleanup()

// Create an instance for testing
globalThis.userDataFactory.createInstance('pubkey-here')

// Destroy a specific instance
globalThis.userDataFactory.destroyInstance('pubkey-here')

// Update pool configuration
globalThis.userDataFactory.updatePoolConfig({ maxPoolSize: 20 })
```

## Monitoring and Debugging

### Debug Console Output
The system integrates with the existing debug logger to show:
- Pool summary statistics
- Instance creation/destruction events
- Cleanup operation results
- Detailed instance information

### Pool Statistics
Regular debug output includes:
- Current pool size
- Active vs idle instances
- Total created/destroyed/reused counts
- Cleanup run statistics
- Individual instance details (pubkey, age, access count)

### Example Debug Output
```
[DebugLogger] Instance Pool Statistics:
┌─────────────────┬────────┐
│ Pool Size       │ 8      │
│ Active Instances│ 5      │
│ Idle Instances  │ 3      │
│ Total Created   │ 47     │
│ Total Destroyed │ 39     │
│ Total Reused    │ 12     │
│ Cleanup Runs    │ 156    │
└─────────────────┴────────┘
```

## Implementation Details

### Instance Lifecycle

1. **Creation Request**
   - Factory receives request for pubkey
   - Check if reusable instance exists
   - Create new instance if needed
   - Register with pool manager

2. **Usage Tracking**
   - Update access time on significant operations
   - Track access count and usage patterns
   - Monitor idle state continuously

3. **Cleanup Decision**
   - Periodic evaluation of all instances
   - Check idle time against threshold
   - Consider UserRelayService state
   - Destroy expired instances

4. **Destruction**
   - Call instance.destroy()
   - Clean up UserRelayService
   - Remove from pool
   - Update statistics

### Smart Reuse Logic
Instances can be reused when:
- Sufficient time has passed since last access
- Instance is not currently performing operations
- UserRelayService is in idle state
- No conflicting usage patterns

### Memory Management
- Automatic pool size limiting
- LRU eviction when pool is full
- Aggressive cleanup under memory pressure
- Proper cleanup of all references

## Benefits

### Performance
- Reduced memory usage over time
- Better resource utilization
- Faster access to recently used instances
- Reduced connection overhead

### Reliability
- Prevents memory leaks
- Automatic resource cleanup
- Graceful handling of idle instances
- Robust error handling

### Monitoring
- Comprehensive logging and statistics
- Real-time pool status
- Debug tools for troubleshooting
- Integration with existing debug infrastructure

## Testing

### Automated Testing
The system can be tested through:
1. Normal app usage (instances created/destroyed automatically)
2. Manual console commands for specific scenarios
3. Configuration changes to test different behaviors
4. Debug output monitoring for validation

### Validation Scenarios
1. **Pool Size Limiting**: Create more instances than maxPoolSize
2. **Idle Cleanup**: Wait for idle timeout and verify cleanup
3. **Instance Reuse**: Request same pubkey multiple times
4. **Memory Pressure**: Create many instances rapidly
5. **Configuration Changes**: Update settings and verify behavior

### Expected Behavior
- Pool size should stabilize at configured maximum
- Idle instances should be cleaned up within timeout period
- Recently used instances should be reused efficiently
- Debug statistics should show reasonable creation/destruction ratios

## Future Enhancements

### Potential Improvements
1. **Memory Pressure Detection**: Automatic cleanup under low memory
2. **Usage Pattern Learning**: Smart cleanup based on usage patterns
3. **Performance Metrics**: Track cleanup performance impact
4. **User Preferences**: Allow user control over cleanup aggressiveness
5. **Persistence**: Save/restore pool state across sessions

### Integration Opportunities
1. **Service Worker Integration**: Cleanup during background sync
2. **Performance Monitoring**: Integration with performance analytics
3. **Error Reporting**: Enhanced error tracking for pool issues
4. **Configuration UI**: User-facing configuration options

## Conclusion

The UserDataService recycling system provides a robust, automatic solution to the resource management challenges in the Nostria application. By implementing smart pooling, usage tracking, and automatic cleanup, it ensures stable memory usage while maintaining optimal performance for active users.

The system is designed to be:
- **Transparent**: Works automatically without user intervention
- **Configurable**: Adjustable to different usage patterns
- **Observable**: Comprehensive logging and statistics
- **Maintainable**: Clean architecture with clear separation of concerns
- **Reliable**: Robust error handling and graceful degradation

This implementation resolves the core issue of growing UserDataService instances while providing a foundation for future enhancements and optimizations.