# RelayServiceBase Usage Example

The updated `RelayServiceBase` now supports editing relays after initialization and provides a signal for monitoring relay changes.

## Key Features Added

1. **Add/Remove Relays**: Add or remove individual relay URLs
2. **Update Relay List**: Replace the entire relay list at once
3. **Clear Relays**: Remove all relays
4. **Relay Monitoring**: Signal that triggers when relays are modified
5. **Utility Methods**: Check if relay exists, get relay count

## Usage Example

```typescript
import { Component, effect, inject } from '@angular/core';
import { RelayServiceBase } from './services/relays/relay-base';

@Component({
  selector: 'app-example',
  template: `
    <div>
      <h3>Current Relays ({{ relayService.getRelayCount() }})</h3>
      <ul>
        @for (relay of relayService.getRelayUrls(); track relay) {
          <li>{{ relay }}</li>
        }
      </ul>
      
      <button (click)="addRelay()">Add Test Relay</button>
      <button (click)="removeRelay()">Remove Test Relay</button>
      <button (click)="updateAllRelays()">Update All Relays</button>
      <button (click)="clearAllRelays()">Clear All Relays</button>
    </div>
  `
})
export class ExampleComponent {
  relayService = inject(RelayService); // Your concrete implementation

  constructor() {
    // Subscribe to relay changes for persistence
    effect(() => {
      const relays = this.relayService.relaysModifiedSignal();
      console.log('Relays modified:', relays);
      
      // Here you could persist to localStorage, IndexedDB, etc.
      localStorage.setItem('user-relays', JSON.stringify(relays));
    });
  }

  addRelay() {
    this.relayService.addRelay('wss://test-relay.example.com');
  }

  removeRelay() {
    this.relayService.removeRelay('wss://test-relay.example.com');
  }

  updateAllRelays() {
    this.relayService.updateRelays([
      'wss://relay1.example.com',
      'wss://relay2.example.com',
      'wss://relay3.example.com'
    ]);
  }

  clearAllRelays() {
    this.relayService.clearRelays();
  }
}
```

## Available Methods

### Relay Management
- `addRelay(relayUrl: string)`: Add a relay URL to the list
- `removeRelay(relayUrl: string)`: Remove a relay URL from the list
- `updateRelays(relayUrls: string[])`: Replace the entire relay list
- `clearRelays()`: Remove all relays
- `hasRelay(relayUrl: string)`: Check if a relay exists
- `getRelayCount()`: Get the number of current relays

### Signal Access
- `relaysModifiedSignal`: Read-only signal that emits the current relay list when modified

## Signal Usage for Persistence

```typescript
import { effect } from '@angular/core';

// In your service or component
constructor() {
  effect(() => {
    const currentRelays = this.relayService.relaysModifiedSignal();
    
    // Persist to localStorage
    localStorage.setItem('user-relays', JSON.stringify(currentRelays));
    
    // Or persist to IndexedDB, send to server, etc.
    this.persistenceService.saveRelays(currentRelays);
  });
}
```

## Loading Relays on Startup

```typescript
async ngOnInit() {
  // Load relays from storage
  const savedRelays = localStorage.getItem('user-relays');
  if (savedRelays) {
    const relayUrls = JSON.parse(savedRelays);
    this.relayService.init(relayUrls);
  } else {
    // Use default relays
    this.relayService.init([
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.snort.social'
    ]);
  }
}
```
