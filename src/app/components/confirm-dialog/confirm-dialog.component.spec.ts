import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { ConfirmDialogComponent, ConfirmDialogData } from './confirm-dialog.component';

describe('ConfirmDialogComponent', () => {
  let component: ConfirmDialogComponent;
  let fixture: ComponentFixture<ConfirmDialogComponent>;
  let mockDialogRef: { close: jasmine.Spy };

  const defaultDialogData: ConfirmDialogData = {
    title: 'Confirm Action',
    message: 'Are you sure?',
    confirmText: 'Yes',
    cancelText: 'No',
    confirmColor: 'warn',
  };

  function createComponent(data: Partial<ConfirmDialogData> = {}) {
    const dialogData = { ...defaultDialogData, ...data };
    mockDialogRef = { close: jasmine.createSpy('close') };

    TestBed.configureTestingModule({
      imports: [ConfirmDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
      ],
    });

    fixture = TestBed.createComponent(ConfirmDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('should create', () => {
    createComponent();
    expect(component).toBeTruthy();
  });

  it('should display the title', async () => {
    createComponent({ title: 'Delete Item' });
    await fixture.whenStable();

    const titleEl = (fixture.nativeElement as HTMLElement).querySelector('[mat-dialog-title]');
    expect(titleEl).toBeTruthy();
    expect(titleEl!.textContent).toContain('Delete Item');
  });

  it('should display the message', async () => {
    createComponent({ message: 'This cannot be undone.' });
    await fixture.whenStable();

    const contentEl = (fixture.nativeElement as HTMLElement).querySelector('mat-dialog-content p');
    expect(contentEl).toBeTruthy();
    expect(contentEl!.textContent).toContain('This cannot be undone.');
  });

  it('should display custom confirm text', async () => {
    createComponent({ confirmText: 'Delete' });
    await fixture.whenStable();

    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    const confirmButton = buttons[buttons.length - 1];
    expect(confirmButton.textContent).toContain('Delete');
  });

  it('should display custom cancel text', async () => {
    createComponent({ cancelText: 'Nevermind' });
    await fixture.whenStable();

    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    const cancelButton = buttons[0];
    expect(cancelButton.textContent).toContain('Nevermind');
  });

  it('should apply confirmColor class to confirm button', async () => {
    createComponent({ confirmColor: 'warn' });
    await fixture.whenStable();

    const confirmButton = (fixture.nativeElement as HTMLElement).querySelector('[mat-flat-button]');
    expect(confirmButton).toBeTruthy();
    expect(confirmButton!.classList.contains('warn')).toBeTrue();
  });

  it('should apply primary class when confirmColor is primary', async () => {
    createComponent({ confirmColor: 'primary' });
    await fixture.whenStable();

    const confirmButton = (fixture.nativeElement as HTMLElement).querySelector('[mat-flat-button]');
    expect(confirmButton).toBeTruthy();
    expect(confirmButton!.classList.contains('primary')).toBeTrue();
  });

  it('should close dialog with true when confirm is clicked', () => {
    createComponent();
    component.confirm();
    expect(mockDialogRef.close).toHaveBeenCalledWith(true);
  });

  it('should close dialog with false when cancel is clicked', () => {
    createComponent();
    component.cancel();
    expect(mockDialogRef.close).toHaveBeenCalledWith(false);
  });

  it('should call confirm when confirm button is clicked', async () => {
    createComponent();
    await fixture.whenStable();

    const confirmButton = (fixture.nativeElement as HTMLElement).querySelector('[mat-flat-button]') as HTMLButtonElement;
    confirmButton.click();
    expect(mockDialogRef.close).toHaveBeenCalledWith(true);
  });

  it('should call cancel when cancel button is clicked', async () => {
    createComponent();
    await fixture.whenStable();

    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    const cancelButton = buttons[0] as HTMLButtonElement;
    cancelButton.click();
    expect(mockDialogRef.close).toHaveBeenCalledWith(false);
  });
});
