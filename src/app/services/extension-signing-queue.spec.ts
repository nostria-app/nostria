import { describe, expect, it } from 'vitest';

function createExclusiveInteractionRunner() {
    let interactionQueue: Promise<void> = Promise.resolve();

    return async function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
        const previous = interactionQueue;
        let release!: () => void;

        interactionQueue = new Promise<void>(resolve => {
            release = resolve;
        });

        await previous.catch(() => undefined);

        try {
            return await operation();
        }
        finally {
            release();
        }
    };
}

async function performExtensionSigningWithExclusiveLock<T>(
    runExclusive: <V>(operation: () => Promise<V>) => Promise<V>,
    signEventFn: () => Promise<T>,
): Promise<T> {
    return runExclusive(() => signEventFn());
}

describe('Extension signing queue serialization', () => {
    it('should not call signEvent until the prior extension interaction releases the lock', async () => {
        const runExclusive = createExclusiveInteractionRunner();
        const callOrder: string[] = [];

        let releasePublicKey!: () => void;
        const publicKeyPromise = runExclusive(async () => {
            callOrder.push('getPublicKey:start');
            await new Promise<void>(resolve => {
                releasePublicKey = resolve;
            });
            callOrder.push('getPublicKey:end');
            return 'pubkey';
        });

        const signPromise = performExtensionSigningWithExclusiveLock(
            runExclusive,
            async () => {
                callOrder.push('signEvent:called');
                return { id: 'signed-event' };
            },
        );

        await Promise.resolve();
        await Promise.resolve();
        expect(callOrder).toEqual(['getPublicKey:start']);

        releasePublicKey();

        await expect(publicKeyPromise).resolves.toBe('pubkey');
        await expect(signPromise).resolves.toEqual({ id: 'signed-event' });
        expect(callOrder).toEqual([
            'getPublicKey:start',
            'getPublicKey:end',
            'signEvent:called',
        ]);
    });

    it('should process queued signing requests in order', async () => {
        const runExclusive = createExclusiveInteractionRunner();
        const callOrder: string[] = [];

        let releaseFirst!: () => void;
        const firstSigning = performExtensionSigningWithExclusiveLock(
            runExclusive,
            async () => {
                callOrder.push('sign:first:start');
                await new Promise<void>(resolve => {
                    releaseFirst = resolve;
                });
                callOrder.push('sign:first:end');
                return { id: 'first' };
            },
        );

        const secondSigning = performExtensionSigningWithExclusiveLock(
            runExclusive,
            async () => {
                callOrder.push('sign:second:start');
                callOrder.push('sign:second:end');
                return { id: 'second' };
            },
        );

        await Promise.resolve();
        await Promise.resolve();
        expect(callOrder).toEqual(['sign:first:start']);

        releaseFirst();

        await expect(firstSigning).resolves.toEqual({ id: 'first' });
        await expect(secondSigning).resolves.toEqual({ id: 'second' });
        expect(callOrder).toEqual([
            'sign:first:start',
            'sign:first:end',
            'sign:second:start',
            'sign:second:end',
        ]);
    });
});