import { Component, Input, OnInit, OnDestroy, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCardModule } from '@angular/material/card';
import { LoggerService } from '../../services/logger.service';

interface LogMessage {
  id: number;
  text: string;
  level: 'debug' | 'info' | 'warn';
  fadeOut: boolean;
}

@Component({
  selector: 'app-loading-overlay',
  standalone: true,
  imports: [MatProgressSpinnerModule, MatCardModule, CommonModule],
  templateUrl: './loading-overlay.component.html',
  styleUrl: './loading-overlay.component.scss'
})
export class LoadingOverlayComponent implements OnInit, OnDestroy {
  @Input() message: string = 'Loading...';
  
  private readonly loggerService = inject(LoggerService);
  
  private messageIdCounter = 0;
  private logCheckInterval?: number;
  
  // Store the current log messages
  private currentLogMessages = signal<LogMessage[]>([]);
  
  // Computed signal that returns the log messages
  logMessages = computed(() => this.currentLogMessages());
  
  ngOnInit(): void {
    // Enable log overlay in the logger service
    this.loggerService.setLogOverlay(true);
    
    // Poll for new log messages every 100ms
    this.logCheckInterval = window.setInterval(() => {
      this.updateLogMessages();
    }, 100);
  }
  
  ngOnDestroy(): void {
    if (this.logCheckInterval) {
      clearInterval(this.logCheckInterval);
    }
    // Optionally disable log overlay when component is destroyed
    // this.loggerService.setLogOverlay(false);
  }
  
  private updateLogMessages(): void {
    const messages: LogMessage[] = [];
    
    // Add debug message if exists
    if (this.loggerService.lastDebug.trim()) {
      messages.push({
        id: this.messageIdCounter++,
        text: this.loggerService.lastDebug,
        level: 'debug',
        fadeOut: false
      });
    }
    
    // Add info message if exists  
    if (this.loggerService.lastInfo.trim()) {
      messages.push({
        id: this.messageIdCounter++,
        text: this.loggerService.lastInfo,
        level: 'info',
        fadeOut: false
      });
    }
    
    // Add warn message if exists
    if (this.loggerService.lastWarn.trim()) {
      messages.push({
        id: this.messageIdCounter++,
        text: this.loggerService.lastWarn,
        level: 'warn',
        fadeOut: false
      });
    }
    
    // Keep only the last 3 messages
    const latestMessages = messages.slice(-3);
    
    // Check if messages have changed
    const currentMessages = this.currentLogMessages();
    const hasChanged = currentMessages.length !== latestMessages.length ||
      currentMessages.some((msg, index) => 
        !latestMessages[index] || 
        msg.text !== latestMessages[index].text ||
        msg.level !== latestMessages[index].level
      );
    
    if (hasChanged) {
      // Mark old messages for fade out if we have more than 3
      if (currentMessages.length > 0 && latestMessages.length === 3) {
        // Find messages that are being removed
        const removingMessages = currentMessages.filter(current => 
          !latestMessages.some(latest => 
            latest.text === current.text && latest.level === current.level
          )
        );
        
        // Mark them for fade out
        removingMessages.forEach(msg => msg.fadeOut = true);
        
        // Update with fade out messages first
        this.currentLogMessages.set([...currentMessages.map(msg => 
          removingMessages.includes(msg) ? { ...msg, fadeOut: true } : msg
        )]);
        
        // Remove faded messages after animation
        setTimeout(() => {
          this.currentLogMessages.set(latestMessages);
        }, 500);
      } else {
        // Direct update if no fade animation needed
        this.currentLogMessages.set(latestMessages);
      }
    }
  }
}
