import type { Mock } from "vitest";
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { TranslateDialogComponent, TranslateDialogData } from './translate-dialog.component';
import { AccountStateService } from '../../../services/account-state.service';

describe('TranslateDialogComponent', () => {
    let component: TranslateDialogComponent;
    let fixture: ComponentFixture<TranslateDialogComponent>;
    let mockDialogRef: {
        close: Mock;
    };
    let mockAccountState: {
        pubkey: ReturnType<typeof signal<string>>;
    };

    const mockDialogData: TranslateDialogData = {
        content: 'Hello, world!',
    };

    beforeEach(async () => {
        mockDialogRef = {
            close: vi.fn(),
        };

        mockAccountState = {
            pubkey: signal('test-pubkey'),
        };

        await TestBed.configureTestingModule({
            imports: [TranslateDialogComponent],
            providers: [
                provideZonelessChangeDetection(),
                provideRouter([]),
                provideAnimationsAsync(),
                { provide: MatDialogRef, useValue: mockDialogRef },
                { provide: MAT_DIALOG_DATA, useValue: mockDialogData },
                { provide: AccountStateService, useValue: mockAccountState },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(TranslateDialogComponent);
        component = fixture.componentInstance;
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should have default source language', () => {
        expect(component.sourceLang()).toBe('en');
    });

    it('should have default target language', () => {
        expect(component.targetLang()).toBe('es');
    });

    it('should not be translating initially', () => {
        expect(component.isTranslating()).toBe(false);
    });

    it('should have no error initially', () => {
        expect(component.error()).toBe('');
    });

    it('should have no translated text initially', () => {
        expect(component.translatedText()).toBe('');
    });

    it('should swap languages', () => {
        component.sourceLang.set('en');
        component.targetLang.set('fr');
        component.swapLanguages();
        expect(component.sourceLang()).toBe('fr');
        expect(component.targetLang()).toBe('en');
    });

    it('should close dialog', () => {
        component.close();
        expect(mockDialogRef.close).toHaveBeenCalled();
    });
});
