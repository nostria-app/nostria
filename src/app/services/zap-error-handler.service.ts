import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

export interface ZapError {
  code: string;
  message: string;
  recoverable: boolean;
  retryDelay?: number;
}

@Injectable({
  providedIn: 'root',
})
export class ZapErrorHandlerService {
  private snackBar = inject(MatSnackBar);

  /**
   * Handle zap errors with appropriate user feedback
   */
  handleZapError(error: unknown): ZapError {
    let zapError: ZapError;

    if (this.isZapError(error)) {
      zapError = error;
    } else if (error instanceof Error) {
      zapError = this.convertToZapError(error);
    } else {
      zapError = {
        code: 'UNKNOWN_ERROR',
        message: 'An unexpected error occurred',
        recoverable: true,
      };
    }

    this.showErrorSnackBar(zapError);
    return zapError;
  }

  /**
   * Show user-friendly error messages
   */
  private showErrorSnackBar(error: ZapError): void {
    const message = this.getUserFriendlyMessage(error);
    const action = error.recoverable ? 'Retry' : 'Dismiss';
    const duration = error.recoverable ? 8000 : 5000;

    this.snackBar.open(message, action, {
      duration,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
      panelClass: ['error-snackbar'],
    });
  }

  /**
   * Convert regular errors to ZapError format
   */
  private convertToZapError(error: Error): ZapError {
    const message = error.message.toLowerCase();

    if (message.includes('network') || message.includes('fetch')) {
      return {
        code: 'NETWORK_ERROR',
        message: 'Network connection failed. Please check your internet connection.',
        recoverable: true,
        retryDelay: 2000,
      };
    }

    if (message.includes('timeout')) {
      return {
        code: 'TIMEOUT_ERROR',
        message: 'Request timed out. Please try again.',
        recoverable: true,
        retryDelay: 1000,
      };
    }

    if (message.includes('invoice') || message.includes('bolt11')) {
      return {
        code: 'INVOICE_ERROR',
        message: 'Invalid Lightning invoice. Please try again.',
        recoverable: true,
      };
    }

    if (message.includes('wallet') || message.includes('payment')) {
      return {
        code: 'WALLET_ERROR',
        message: 'Wallet payment failed. Please check your wallet connection.',
        recoverable: true,
        retryDelay: 3000,
      };
    }

    if (message.includes('recipient')) {
      return {
        code: 'RECIPIENT_ERROR',
        message: error.message,
        recoverable: false,
      };
    }

    if (message.includes('no lightning address')) {
      return {
        code: 'NO_LIGHTNING_ADDRESS',
        message: 'This user has not configured Lightning payments.',
        recoverable: false,
      };
    }

    if (message.includes('amount must be between')) {
      return {
        code: 'AMOUNT_OUT_OF_RANGE',
        message: error.message,
        recoverable: false,
      };
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: error.message || 'An unexpected error occurred',
      recoverable: true,
    };
  }

  /**
   * Get user-friendly error messages
   */
  private getUserFriendlyMessage(error: ZapError): string {
    switch (error.code) {
      case 'NETWORK_ERROR':
        return '🌐 Network error. Check your connection and try again.';
      case 'TIMEOUT_ERROR':
        return '⏱️ Request timed out. Please try again.';
      case 'WALLET_ERROR':
        return '💳 Wallet payment failed. Check your wallet connection.';
      case 'INVOICE_ERROR':
        return '⚡ Lightning invoice error. Please try again.';
      case 'NO_LIGHTNING_ADDRESS':
        return '❌ This user cannot receive Lightning payments.';
      case 'AMOUNT_OUT_OF_RANGE':
        return '💰 Invalid amount. ' + error.message;
      case 'RECIPIENT_ERROR':
        return '👤 ' + error.message;
      default:
        return '❌ ' + error.message;
    }
  }

  /**
   * Type guard to check if error is a ZapError
   */
  private isZapError(error: unknown): error is ZapError {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      'message' in error &&
      'recoverable' in error
    );
  }
}
