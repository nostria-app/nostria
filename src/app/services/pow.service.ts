import { Injectable, signal } from '@angular/core';
import { Event as NostrEvent, getEventHash, UnsignedEvent } from 'nostr-tools';

export interface PowResult {
  event: UnsignedEvent;
  difficulty: number;
  nonce: number;
  attempts: number;
}

export interface PowProgress {
  difficulty: number;
  nonce: number;
  attempts: number;
  isRunning: boolean;
  bestEvent: UnsignedEvent | null;
}

@Injectable({
  providedIn: 'root',
})
export class PowService {
  // Signals for reactive state
  progress = signal<PowProgress>({
    difficulty: 0,
    nonce: 0,
    attempts: 0,
    isRunning: false,
    bestEvent: null,
  });

  private shouldStop = false;
  private currentController: AbortController | null = null;

  /**
   * Count leading zero bits in a hex string (event ID)
   * Based on NIP-13 specification
   */
  countLeadingZeroBits(hex: string): number {
    let count = 0;

    for (const char of hex) {
      const nibble = parseInt(char, 16);
      if (nibble === 0) {
        count += 4;
      } else {
        count += Math.clz32(nibble) - 28;
        break;
      }
    }

    return count;
  }

  /**
   * Mine an event with Proof of Work
   * @param baseEvent The base event to mine (without nonce tag)
   * @param targetDifficulty The target difficulty (number of leading zero bits)
   * @param onProgress Callback for progress updates
   * @returns Promise that resolves with the mined event and metadata
   */
  async mineEvent(
    baseEvent: UnsignedEvent,
    targetDifficulty: number,
    onProgress?: (progress: PowProgress) => void
  ): Promise<PowResult | null> {
    this.shouldStop = false;
    this.currentController = new AbortController();

    let bestDifficulty = 0;
    let bestEvent: UnsignedEvent | null = null;
    let nonce = 0;
    let attempts = 0;

    // Reset progress
    this.progress.set({
      difficulty: 0,
      nonce: 0,
      attempts: 0,
      isRunning: true,
      bestEvent: null,
    });

    // Update created_at to current time
    const startTime = Math.floor(Date.now() / 1000);

    try {
      while (!this.shouldStop) {
        attempts++;
        nonce++;

        // Create event with current nonce
        // Remove any existing nonce tag first
        const tagsWithoutNonce = baseEvent.tags.filter(tag => tag[0] !== 'nonce');
        const eventToMine: UnsignedEvent = {
          ...baseEvent,
          created_at: startTime,
          tags: [...tagsWithoutNonce, ['nonce', nonce.toString(), targetDifficulty.toString()]],
        };

        // Calculate event hash
        const eventId = getEventHash(eventToMine);
        const difficulty = this.countLeadingZeroBits(eventId);

        // Update best result if we found a better one
        if (difficulty > bestDifficulty) {
          bestDifficulty = difficulty;
          bestEvent = eventToMine;

          // Update progress
          const progressUpdate: PowProgress = {
            difficulty: bestDifficulty,
            nonce: nonce,
            attempts: attempts,
            isRunning: true,
            bestEvent: bestEvent,
          };
          this.progress.set(progressUpdate);

          if (onProgress) {
            onProgress(progressUpdate);
          }

          // Check if we've reached target difficulty
          if (difficulty >= targetDifficulty) {
            break;
          }
        }

        // Yield to browser event loop every 1000 attempts
        if (attempts % 1000 === 0) {
          await this.sleep(0);

          // Update progress even if no new best was found
          const progressUpdate: PowProgress = {
            difficulty: bestDifficulty,
            nonce: nonce,
            attempts: attempts,
            isRunning: true,
            bestEvent: bestEvent,
          };
          this.progress.set(progressUpdate);

          if (onProgress) {
            onProgress(progressUpdate);
          }
        }

        // Check if aborted
        if (this.currentController?.signal.aborted) {
          break;
        }
      }

      // Final progress update
      this.progress.set({
        difficulty: bestDifficulty,
        nonce: nonce,
        attempts: attempts,
        isRunning: false,
        bestEvent: bestEvent,
      });

      if (bestEvent) {
        return {
          event: bestEvent,
          difficulty: bestDifficulty,
          nonce: nonce,
          attempts: attempts,
        };
      }

      return null;
    } catch (error) {
      console.error('Error during PoW mining:', error);
      this.progress.update(p => ({ ...p, isRunning: false }));
      return null;
    }
  }

  /**
   * Pause/stop the current mining operation
   */
  stop(): void {
    this.shouldStop = true;
    this.currentController?.abort();
    this.progress.update(p => ({ ...p, isRunning: false }));
  }

  /**
   * Check if mining is currently running
   */
  isRunning(): boolean {
    return this.progress().isRunning;
  }

  /**
   * Reset progress state
   */
  reset(): void {
    this.shouldStop = false;
    this.currentController = null;
    this.progress.set({
      difficulty: 0,
      nonce: 0,
      attempts: 0,
      isRunning: false,
      bestEvent: null,
    });
  }

  /**
   * Utility to sleep for a given number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate an event's proof of work
   */
  validatePow(event: NostrEvent | UnsignedEvent, expectedDifficulty: number): boolean {
    const eventId = 'id' in event ? event.id : getEventHash(event);
    const actualDifficulty = this.countLeadingZeroBits(eventId);

    // Check if event has nonce tag with committed difficulty
    const nonceTag = event.tags.find(tag => tag[0] === 'nonce');
    if (!nonceTag) {
      return false;
    }

    // Check committed difficulty (third element of nonce tag)
    const committedDifficulty = nonceTag[2] ? parseInt(nonceTag[2], 10) : 0;

    return actualDifficulty >= expectedDifficulty && committedDifficulty >= expectedDifficulty;
  }
}
