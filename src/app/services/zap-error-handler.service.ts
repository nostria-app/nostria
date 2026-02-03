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
    const errorName = error.name?.toLowerCase() || '';

    // Check for NIP-47 specific errors first
    if (errorName.includes('nip47') || message.includes('nip47')) {
      if (message.includes('timeout') || message.includes('reply timeout')) {
        return {
          code: 'NIP47_TIMEOUT',
          message: 'Your wallet did not respond in time. This could be due to network issues or your wallet being offline. Please check your wallet connection and try again.',
          recoverable: true,
          retryDelay: 3000,
        };
      }
      return {
        code: 'NIP47_ERROR',
        message: 'Wallet connection error. Please check if your NWC wallet is online and properly configured.',
        recoverable: true,
        retryDelay: 2000,
      };
    }

    if (message.includes('network') || message.includes('fetch') || message.includes('failed to fetch')) {
      return {
        code: 'NETWORK_ERROR',
        message: 'Network connection failed. Please check your internet connection and try again.',
        recoverable: true,
        retryDelay: 2000,
      };
    }

    if (message.includes('timeout') || message.includes('timed out')) {
      return {
        code: 'TIMEOUT_ERROR',
        message: 'The request timed out. The wallet or Lightning network might be slow. Please try again.',
        recoverable: true,
        retryDelay: 2000,
      };
    }

    if (message.includes('invoice') || message.includes('bolt11')) {
      return {
        code: 'INVOICE_ERROR',
        message: 'Failed to process Lightning invoice. The invoice may be invalid or expired. Please try again.',
        recoverable: true,
      };
    }

    if (message.includes('insufficient') || message.includes('balance')) {
      return {
        code: 'INSUFFICIENT_FUNDS',
        message: 'Insufficient funds in your wallet. Please add more sats and try again.',
        recoverable: false,
      };
    }

    if (message.includes('wallet') || message.includes('payment')) {
      return {
        code: 'WALLET_ERROR',
        message: 'Wallet payment failed. Please check your wallet connection and try again.',
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

    if (message.includes('no lightning address') || message.includes('cannot receive')) {
      return {
        code: 'NO_LIGHTNING_ADDRESS',
        message: 'This user has not configured Lightning payments and cannot receive zaps.',
        recoverable: false,
      };
    }

    if (message.includes('amount must be between') || message.includes('amount out of range')) {
      return {
        code: 'AMOUNT_OUT_OF_RANGE',
        message: error.message,
        recoverable: false,
      };
    }

    if (message.includes('rejected') || message.includes('refused')) {
      return {
        code: 'PAYMENT_REJECTED',
        message: 'The payment was rejected. This could be due to routing issues or the recipient being unavailable.',
        recoverable: true,
        retryDelay: 5000,
      };
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: error.message || 'An unexpected error occurred. Please try again.',
      recoverable: true,
    };
  }

  /**
   * Get user-friendly error messages
   */
  private getUserFriendlyMessage(error: ZapError): string {
    switch (error.code) {
      case 'NETWORK_ERROR':
        return 'Network error. Check your connection and try again.';
      case 'TIMEOUT_ERROR':
        return 'Request timed out. Please try again.';
      case 'NIP47_TIMEOUT':
        return 'Wallet did not respond. Check your wallet connection and try again.';
      case 'NIP47_ERROR':
        return 'Wallet connection error. Check if your NWC wallet is online.';
      case 'WALLET_ERROR':
        return 'Wallet payment failed. Check your wallet connection.';
      case 'INVOICE_ERROR':
        return 'Lightning invoice error. Please try again.';
      case 'NO_LIGHTNING_ADDRESS':
        return 'This user cannot receive Lightning payments.';
      case 'AMOUNT_OUT_OF_RANGE':
        return 'Invalid amount. ' + error.message;
      case 'RECIPIENT_ERROR':
        return error.message;
      case 'INSUFFICIENT_FUNDS':
        return 'Insufficient funds in your wallet.';
      case 'PAYMENT_REJECTED':
        return 'Payment was rejected. Please try again.';
      default:
        return error.message;
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
