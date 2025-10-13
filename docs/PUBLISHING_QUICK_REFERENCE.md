# Publishing Quick Reference

## Basic Usage

### Import and Inject

```typescript
import { PublishService } from './services/publish.service';

export class MyComponent {
  private readonly publishService = inject(PublishService);
  private readonly nostrService = inject(NostrService);
}
```

## Common Patterns

### 1. Publish a Regular Note

```typescript
const event = nostrService.createEvent(1, 'Hello Nostr!', []);
const signedEvent = await nostrService.signEvent(event);
await publishService.publish(signedEvent);
```

### 2. Follow a User (with notification)

```typescript
const followEvent = createFollowListEvent(pubkey);
const signedEvent = await nostrService.signEvent(followEvent);

// This will publish to the newly followed user's relays too
await publishService.publish(signedEvent, {
  notifyFollowed: true,
  useOptimizedRelays: false,     // Use ALL relays for max reach
  newlyFollowedPubkeys: [pubkey] // Specify who was just followed
});
```

### 3. Legacy Pattern (still works)

```typescript
const event = createEvent();
accountState.publish.set(event); // Auto-signs and publishes
```

### 4. Custom Relays

```typescript
await publishService.publish(signedEvent, {
  relayUrls: ['wss://relay1.com', 'wss://relay2.com'],
  useOptimizedRelays: false
});
```

### 5. With Error Handling

```typescript
const result = await publishService.publish(signedEvent);

if (!result.success) {
  result.relayResults.forEach((res, url) => {
    if (!res.success) {
      console.error(`Failed: ${url} - ${res.error}`);
    }
  });
}
```

## Options Reference

```typescript
interface PublishOptions {
  // Explicit relay URLs to use
  relayUrls?: string[];
  
  // Use optimized relay selection (default: true)
  useOptimizedRelays?: boolean;
  
  // For kind 3: publish to newly followed users' relays (default: true)
  notifyFollowed?: boolean;
  
  // For kind 3: specific pubkeys that were newly followed (for targeted notification)
  newlyFollowedPubkeys?: string[];
  
  // Timeout in milliseconds (default: 10000)
  timeout?: number;
}
```

## Event Kind Guidelines

### Kind 1 (Note)
```typescript
{ useOptimizedRelays: true }
```

### Kind 3 (Follow List)
```typescript
{ 
  notifyFollowed: true, 
  useOptimizedRelays: false,
  newlyFollowedPubkeys: ['pubkey1', 'pubkey2']  // Only newly followed users
}
```

### Kind 0 (Metadata)
```typescript
{ useOptimizedRelays: true }
```

### Kind 7 (Reaction)
```typescript
{ useOptimizedRelays: true }
```

## Result Object

```typescript
interface PublishResult {
  success: boolean;  // True if at least one relay succeeded
  relayResults: Map<string, {
    success: boolean;
    error?: string;
  }>;
  event: Event;  // The published event
}
```

## Quick Tips

- ✅ Use `notifyFollowed: true` for kind 3 (follow list) events
- ✅ Use `useOptimizedRelays: false` for kind 3 to maximize notification reach
- ✅ Specify `newlyFollowedPubkeys` for efficient targeted notifications (recommended)
- ✅ Legacy signal pattern still works: `accountState.publish.set(event)`
- ✅ Check `result.success` after publishing
- ✅ Iterate `result.relayResults` for per-relay details
- ⚠️ Kind 3 events automatically published to newly followed users' relays (not all followed users)
- ⚠️ Optimization is enabled by default - disable for critical events

## Complete Example

```typescript
export class PostComponent {
  private readonly publishService = inject(PublishService);
  private readonly nostrService = inject(NostrService);

  async publishPost(content: string) {
    try {
      // Create and sign event
      const event = this.nostrService.createEvent(1, content, []);
      const signedEvent = await this.nostrService.signEvent(event);

      // Publish with default options (optimized relays)
      const result = await this.publishService.publish(signedEvent);

      // Handle result
      if (result.success) {
        const successCount = Array.from(result.relayResults.values())
          .filter(r => r.success).length;
        console.log(`Published to ${successCount} relays`);
        return true;
      } else {
        console.error('Failed to publish to any relay');
        return false;
      }
    } catch (error) {
      console.error('Error publishing:', error);
      return false;
    }
  }

  async followUser(pubkey: string) {
    try {
      // Create follow list event
      const event = this.createFollowEvent(pubkey);
      const signedEvent = await this.nostrService.signEvent(event);

      // Publish with special kind 3 handling
      const result = await this.publishService.publish(signedEvent, {
        notifyFollowed: true,         // Publish to newly followed user's relays
        useOptimizedRelays: false,    // Use all relays for notifications
        newlyFollowedPubkeys: [pubkey] // Specify who was just followed
      });

      return result.success;
    } catch (error) {
      console.error('Error following user:', error);
      return false;
    }
  }

  private createFollowEvent(pubkey: string) {
    // Implementation details...
  }
}
```
