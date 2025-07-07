import { inject, Injectable } from '@angular/core';
import { NostrService } from './nostr.service';

@Injectable({
  providedIn: 'root'
})
export class QueueService {
  constructor() { }

  // A queue for publishing Nostr events. Needs to process events in order and wait for signing.
  private queue: (() => Promise<void>)[] = [];

  // Add a task to the queue
  add(task: () => Promise<void>): void {
    this.queue.push(task);
    if (this.queue.length === 1) {
      this.processQueue();
    }
  }

  // Process the queue
  private async processQueue(): Promise<void> {
    while (this.queue.length > 0) {
      const task = this.queue[0];
      try {
        await task();
      } catch (error) {
        console.error('Error processing queue task:', error);
      }
      this.queue.shift(); // Remove the task after processing
    }
  }

  // Clear the queue
  clear(): void {
    this.queue = [];
  }

  // Check if the queue is empty
  isEmpty(): boolean {
    return this.queue.length === 0;
  } 

  // Get the current queue length
  get length(): number {
    return this.queue.length;
  }

  // Get the current queue
  get currentQueue(): (() => Promise<void>)[] {
    return [...this.queue]; // Return a copy of the queue
  }
}
