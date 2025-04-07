import { Injectable, inject, signal } from '@angular/core';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

@Injectable({
  providedIn: 'root'
})
export class LoggerService {
  private readonly LOG_LEVEL_KEY = 'nostria-log-level';
  
  // Log level precedence: debug < info < warn < error < none
  private readonly levelPrecedence: Record<LogLevel, number> = {
    'debug': 0,
    'info': 1,
    'warn': 2,
    'error': 3,
    'none': 4
  };
  
  // Current log level - can be changed at runtime
  logLevel = signal<LogLevel>(this.getStoredLogLevel());
  
  constructor() {
    console.log(`LoggerService initialized with log level: ${this.logLevel()}`);
  }
  
  private getStoredLogLevel(): LogLevel {
    const storedLevel = localStorage.getItem(this.LOG_LEVEL_KEY) as LogLevel | null;
    return storedLevel || 'info'; // Default to info level
  }
  
  setLogLevel(level: LogLevel): void {
    this.logLevel.set(level);
    localStorage.setItem(this.LOG_LEVEL_KEY, level);
  }
  
  private shouldLog(level: LogLevel): boolean {
    return this.levelPrecedence[level] >= this.levelPrecedence[this.logLevel()];
  }
  
  private getTimestamp(): string {
    return new Date().toISOString();
  }
  
  private formatMessage(level: LogLevel, message: any, ...optionalParams: any[]): [string, ...any[]] {
    const timestamp = this.getTimestamp();
    const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    return [formattedMessage, ...optionalParams];
  }
  
  debug(message: any, ...optionalParams: any[]): void {
    if (this.shouldLog('debug')) {
      console.debug(...this.formatMessage('debug', message, ...optionalParams));
    }
  }
  
  info(message: any, ...optionalParams: any[]): void {
    if (this.shouldLog('info')) {
      console.info(...this.formatMessage('info', message, ...optionalParams));
    }
  }
  
  warn(message: any, ...optionalParams: any[]): void {
    if (this.shouldLog('warn')) {
      console.warn(...this.formatMessage('warn', message, ...optionalParams));
    }
  }
  
  error(message: any, ...optionalParams: any[]): void {
    if (this.shouldLog('error')) {
      console.error(...this.formatMessage('error', message, ...optionalParams));
    }
  }
  
  log(message: any, ...optionalParams: any[]): void {
    // Alias for info
    this.info(message, ...optionalParams);
  }
  
  group(label: string): void {
    if (this.shouldLog('debug')) {
      console.group(this.formatMessage('debug', label)[0]);
    }
  }
  
  groupEnd(): void {
    if (this.shouldLog('debug')) {
      console.groupEnd();
    }
  }
  
  // Time tracking methods
  private timers: Record<string, number> = {};
  
  time(label: string): void {
    if (this.shouldLog('debug')) {
      this.timers[label] = performance.now();
    }
  }
  
  timeEnd(label: string): void {
    if (this.shouldLog('debug') && this.timers[label]) {
      const duration = performance.now() - this.timers[label];
      console.log(...this.formatMessage('debug', `${label}: ${duration.toFixed(2)}ms`));
      delete this.timers[label];
    }
  }
}
