# Publishing Service Examples

These examples show how to use the new `PublishService` for various publishing scenarios.

## Example 1: Publishing a Regular Note with Optimized Relays

```typescript
  async publishNote(content: string) {
    const event = this.nostrService.createEvent(1, content, []);
    const signedEvent = await this.nostrService.signEvent(event);

    const result = await this.publishService.publish(signedEvent, {
      useOptimizedRelays: true, // Use best performing relays
    });

    if (result.success) {
      console.log('Note published successfully!');
    } else {
      console.error('Failed to publish note');
    }

    return result;
  }
}
```

## Example 2: Following a User - Publishes to Their Relays Too

```typescript
  async followUser(pubkey: string) {
    const account = this.accountState.account();
    if (!account) return;

    // Get existing follow list
    const followingEvent = await this.nostrService.storage.getEventByPubkeyAndKind(
      [account.pubkey],
      3
    );

    // Create updated follow list
    const tags = followingEvent?.tags || [];
    tags.push(['p', pubkey]);

    const event = this.nostrService.createEvent(3, '', tags);
    const signedEvent = await this.nostrService.signEvent(event);

    // Publish with special kind 3 handling
    const result = await this.publishService.publish(signedEvent, {
      notifyFollowed: true,      // Publish to followed users' relays
      useOptimizedRelays: false, // Use ALL relays for maximum notification reach
    });

    if (result.success) {
      console.log('Follow event published - user will be notified!');
    }

    return result;
  }
}
```

## Example 3: Legacy Pattern (Still Works)

```typescript
  async followUserLegacy(pubkey: string) {
    const account = this.accountState.account();
    if (!account) return;

    const followingEvent = await this.nostrService.storage.getEventByPubkeyAndKind(
      [account.pubkey],
      3
    );

    const tags = followingEvent?.tags || [];
    tags.push(['p', pubkey]);

    const event = this.nostrService.createEvent(3, '', tags);

    // Old pattern - still works, uses PublishService internally
    this.accountState.publish.set(event);
  }
}
```

## Example 4: Publishing to Specific Relays

```typescript
  async publishToCustomRelays(content: string, relayUrls: string[]) {
    const event = this.nostrService.createEvent(1, content, []);
    const signedEvent = await this.nostrService.signEvent(event);

    const result = await this.publishService.publish(signedEvent, {
      relayUrls: relayUrls,      // Use specific relays
      useOptimizedRelays: false, // Don't optimize, use exactly these relays
    });

    return result;
  }
}
```

## Example 5: Publishing with Detailed Error Handling

```typescript
  async publishWithErrorHandling(content: string) {
    const event = this.nostrService.createEvent(1, content, []);
    const signedEvent = await this.nostrService.signEvent(event);

    const result = await this.publishService.publish(signedEvent);

    if (result.success) {
      // Check which relays succeeded
      const successfulRelays: string[] = [];
      const failedRelays: string[] = [];

      result.relayResults.forEach((relayResult, url) => {
        if (relayResult.success) {
          successfulRelays.push(url);
        } else {
          failedRelays.push(url);
          console.error(`Failed to publish to ${url}: ${relayResult.error}`);
        }
      });

      console.log(`Published to ${successfulRelays.length}/${result.relayResults.size} relays`);

      // Decide if partial success is acceptable
      if (successfulRelays.length === 0) {
        throw new Error('Failed to publish to any relay');
      }
    }

    return result;
  }
}
```

## Example 6: Using Convenience Method from NostrService

```typescript
  async publishNoteSimple(content: string) {
    const event = this.nostrService.createEvent(1, content, []);

    // This uses PublishService internally
    const success = await this.nostrService.signAndPublish(event);

    return success;
  }
}
