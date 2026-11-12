import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ZapErrorHandlerService } from './zap-error-handler.service';

describe('ZapErrorHandlerService', () => {
  function createService(): { service: ZapErrorHandlerService; open: ReturnType<typeof vi.fn> } {
    const open = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ZapErrorHandlerService,
        { provide: MatSnackBar, useValue: { open } },
      ],
    });
    return { service: TestBed.inject(ZapErrorHandlerService), open };
  }

  it('reports a signer timeout as the signer not responding', () => {
    const { service, open } = createService();

    const result = service.handleZapError(new Error('Signer response timed out'));

    expect(result.code).toBe('SIGNER_TIMEOUT');
    expect(open).toHaveBeenCalledWith(
      "Your signer didn't respond. Nothing was changed.",
      'Retry',
      expect.any(Object),
    );
  });

  it('still reports other timeouts as a slow wallet or Lightning network', () => {
    const { service, open } = createService();

    const result = service.handleZapError(new Error('The request timed out'));

    expect(result.code).toBe('TIMEOUT_ERROR');
    expect(result.message).toContain('Lightning');
    expect(open.mock.calls[0][0]).not.toContain("signer didn't respond");
  });
});
