# Router State Example

## How to Pass Event Data Through Router Navigation

The Link component now passes the event data through router state when navigating. Here's how it works:

### In the Link Component (sender)

```typescript
// Method to navigate with event data
navigateToEvent() {
  const route = this.link();
  if (route) {
    this.router.navigate([route], {
      state: { event: this.event() },
    });
  }
}
```

### In Destination Components (receiver)

#### EventPageComponent

```typescript
constructor() {
  // Check for router navigation state
  const navigation = this.router.getCurrentNavigation();
  if (navigation?.extras.state?.['event']) {
    console.log('Router state event data:', navigation.extras.state['event']);
    this.event.set(navigation.extras.state['event'] as Event);
  }
}
```

#### ProfileComponent

```typescript
constructor() {
  // Check for router navigation state
  const navigation = this.router.getCurrentNavigation();
  if (navigation?.extras.state?.['event']) {
    console.log('Router state event data for profile:', navigation.extras.state['event']);
    // Handle the event data as needed for profile context
  }
}
```

### Alternative: Using History API directly

If you need to access the state data later (not just in constructor), you can use:

```typescript
// In any component method
const state = window.history.state;
if (state && state.event) {
  console.log('Event data from history state:', state.event);
}
```

### Benefits

1. **Performance**: Event data is passed directly without additional API calls
2. **Reliability**: Data is immediately available in the destination component
3. **Consistency**: Works with both event pages (`/e/:id`) and profile pages (`/p/:id`)
4. **Fallback**: Original resolver-based loading still works if state data is not available

### Usage

When users click on the Link component, they will navigate to the event/profile page with the event data already available, reducing loading time and providing a smoother user experience.
