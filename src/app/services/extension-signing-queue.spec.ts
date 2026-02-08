import { Subject } from 'rxjs';

/**
 * Tests for the extension signing queue dialog lifecycle.
 *
 * The core bug:  When multiple extension signing requests are processed
 * sequentially, a previous dialog's `afterClosed()` can fire *after* the next
 * dialog has opened.  The old `afterClosed` handler must NOT interfere with the
 * new dialog reference – otherwise the new dialog never gets closed.
 *
 * We reproduce the exact concurrency pattern from NostrService by simulating
 * the dialog open / afterClosed / close lifecycle and the Promise.race between
 * `window.nostr.signEvent()` and dialog dismissal.
 */

/** Minimal mock for MatDialogRef */
interface MockDialogRef {
  id: string;
  afterClosed$: Subject<void>;
  afterClosed: () => { subscribe: (fn: () => void) => void };
  close: () => void;
  closed: boolean;
}

function createMockDialogRef(id: string): MockDialogRef {
  const afterClosed$ = new Subject<void>();
  return {
    id,
    afterClosed$,
    afterClosed: () => ({
      subscribe: (fn: () => void) => afterClosed$.subscribe(fn),
    }),
    close: jasmine.createSpy(`close-${id}`).and.callFake(() => {
      // In real Angular Material, afterClosed fires asynchronously after close()
      // We simulate this by emitting on the next microtask
      Promise.resolve().then(() => afterClosed$.next());
    }),
    closed: false,
  };
}

/**
 * Simulates performExtensionSigning with the FIXED logic
 * (localDialogRef identity check instead of truthiness check).
 */
async function performExtensionSigningFixed(
  state: { currentSigningDialogRef: MockDialogRef | null },
  openDialog: () => MockDialogRef,
  signEventFn: () => Promise<{ id: string }>
): Promise<{ id: string }> {
  // Safety check – close stale dialog
  if (state.currentSigningDialogRef) {
    state.currentSigningDialogRef.close();
    state.currentSigningDialogRef = null;
  }

  // Open dialog
  state.currentSigningDialogRef = openDialog();
  const localDialogRef = state.currentSigningDialogRef;

  const dialogClosedPromise = new Promise<never>((_, reject) => {
    localDialogRef.afterClosed().subscribe(() => {
      // FIXED: compare identity, not just truthiness
      if (state.currentSigningDialogRef === localDialogRef) {
        state.currentSigningDialogRef = null;
        reject(new Error('Signing cancelled by user'));
      }
    });
  });

  try {
    const extensionResult = await Promise.race([
      signEventFn(),
      dialogClosedPromise,
    ]);
    return extensionResult;
  } finally {
    if (state.currentSigningDialogRef) {
      const dialogRef = state.currentSigningDialogRef;
      state.currentSigningDialogRef = null;
      dialogRef.close();
    }
  }
}

/**
 * Simulates performExtensionSigning with the BUGGY logic
 * (truthiness check only – the original code before the fix).
 */
async function performExtensionSigningBuggy(
  state: { currentSigningDialogRef: MockDialogRef | null },
  openDialog: () => MockDialogRef,
  signEventFn: () => Promise<{ id: string }>
): Promise<{ id: string }> {
  // Safety check – close stale dialog
  if (state.currentSigningDialogRef) {
    state.currentSigningDialogRef.close();
    state.currentSigningDialogRef = null;
  }

  // Open dialog
  state.currentSigningDialogRef = openDialog();

  const dialogClosedPromise = new Promise<never>((_, reject) => {
    state.currentSigningDialogRef?.afterClosed().subscribe(() => {
      // BUGGY: truthiness check – any non-null value will match
      if (state.currentSigningDialogRef) {
        state.currentSigningDialogRef = null;
        reject(new Error('Signing cancelled by user'));
      }
    });
  });

  try {
    const extensionResult = await Promise.race([
      signEventFn(),
      dialogClosedPromise,
    ]);
    return extensionResult;
  } finally {
    if (state.currentSigningDialogRef) {
      const dialogRef = state.currentSigningDialogRef;
      state.currentSigningDialogRef = null;
      dialogRef.close();
    }
  }
}

describe('Extension signing queue dialog lifecycle', () => {
  it('FIXED: sequential signing requests should each close their dialog', async () => {
    const state: { currentSigningDialogRef: MockDialogRef | null } = {
      currentSigningDialogRef: null,
    };

    const dialogA = createMockDialogRef('A');
    const dialogB = createMockDialogRef('B');

    let resolveSignA: (v: { id: string }) => void;
    const signPromiseA = new Promise<{ id: string }>(r => (resolveSignA = r));

    let resolveSignB: (v: { id: string }) => void;
    const signPromiseB = new Promise<{ id: string }>(r => (resolveSignB = r));

    // Start request A
    const resultAPromise = performExtensionSigningFixed(
      state,
      () => dialogA,
      () => signPromiseA
    );

    // Extension resolves request A
    resolveSignA!({ id: 'event-A' });
    const resultA = await resultAPromise;
    expect(resultA.id).toBe('event-A');

    // At this point the finally block has called dialogA.close(), but afterClosed
    // fires asynchronously.  Start request B *before* afterClosed fires.
    const resultBPromise = performExtensionSigningFixed(
      state,
      () => dialogB,
      () => signPromiseB
    );

    // Let dialogA's afterClosed fire (microtask scheduled by close())
    await Promise.resolve();
    await Promise.resolve();

    // The key assertion: currentSigningDialogRef should still point to dialogB
    expect(state.currentSigningDialogRef).toBe(dialogB);

    // Extension resolves request B (auto-approve / "allow 5 min")
    resolveSignB!({ id: 'event-B' });
    const resultB = await resultBPromise;
    expect(resultB.id).toBe('event-B');

    // Dialog B should have been closed by the finally block
    expect(dialogB.close).toHaveBeenCalled();
  });

  it('BUGGY (old code): previous dialog afterClosed nulls current dialog ref', async () => {
    const state: { currentSigningDialogRef: MockDialogRef | null } = {
      currentSigningDialogRef: null,
    };

    const dialogA = createMockDialogRef('A');
    const dialogB = createMockDialogRef('B');

    let resolveSignA: (v: { id: string }) => void;
    const signPromiseA = new Promise<{ id: string }>(r => (resolveSignA = r));

    let resolveSignB: (v: { id: string }) => void;
    const signPromiseB = new Promise<{ id: string }>(r => (resolveSignB = r));

    // Start request A
    const resultAPromise = performExtensionSigningBuggy(
      state,
      () => dialogA,
      () => signPromiseA
    );

    // Extension resolves request A
    resolveSignA!({ id: 'event-A' });
    await resultAPromise;

    // Start request B before dialogA's afterClosed fires
    const resultBPromise = performExtensionSigningBuggy(
      state,
      () => dialogB,
      () => signPromiseB
    );

    // Let dialogA's afterClosed fire
    await Promise.resolve();
    await Promise.resolve();

    // BUG: dialogA's afterClosed sees currentSigningDialogRef is non-null
    // (it's dialogB) and nulls it out
    expect(state.currentSigningDialogRef).toBeNull();

    // Extension resolves request B
    resolveSignB!({ id: 'event-B' });
    const resultB = await resultBPromise;
    expect(resultB.id).toBe('event-B');

    // BUG: dialogB.close() was NOT called because the finally block saw
    // currentSigningDialogRef as null
    expect(dialogB.close).not.toHaveBeenCalled();
  });

  it('FIXED: user closing the active dialog should cancel signing', async () => {
    const state: { currentSigningDialogRef: MockDialogRef | null } = {
      currentSigningDialogRef: null,
    };

    const dialog = createMockDialogRef('X');

    // A signEvent that never resolves (user will cancel)
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const signPromise = new Promise<{ id: string }>(() => {});

    const resultPromise = performExtensionSigningFixed(
      state,
      () => dialog,
      () => signPromise
    );

    // Simulate user closing the dialog
    dialog.afterClosed$.next();

    await expectAsync(resultPromise).toBeRejectedWithError('Signing cancelled by user');
    expect(state.currentSigningDialogRef).toBeNull();
  });

  it('FIXED: should handle rapid sequential requests without leaking dialogs', async () => {
    const state: { currentSigningDialogRef: MockDialogRef | null } = {
      currentSigningDialogRef: null,
    };

    const dialogs: MockDialogRef[] = [];
    const resolvers: ((v: { id: string }) => void)[] = [];

    // Simulate 5 rapid sequential requests
    for (let i = 0; i < 5; i++) {
      const dialog = createMockDialogRef(`D${i}`);
      dialogs.push(dialog);

      let resolve: (v: { id: string }) => void;
      const signPromise = new Promise<{ id: string }>(r => (resolve = r));
      resolvers.push(resolve!);

      const resultPromise = performExtensionSigningFixed(
        state,
        () => dialog,
        () => signPromise
      );

      // Extension resolves immediately (auto-approved)
      resolve!({ id: `event-${i}` });
      const result = await resultPromise;
      expect(result.id).toBe(`event-${i}`);

      // Allow afterClosed to fire
      await Promise.resolve();
      await Promise.resolve();
    }

    // All dialogs should have been closed
    for (const dialog of dialogs) {
      expect(dialog.close).toHaveBeenCalled();
    }

    // No lingering reference
    expect(state.currentSigningDialogRef).toBeNull();
  });
});
