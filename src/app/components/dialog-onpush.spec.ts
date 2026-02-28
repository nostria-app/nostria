import { Type } from '@angular/core';

import { ConfirmDialogComponent } from './confirm-dialog/confirm-dialog.component';
import { CustomDialogComponent } from './custom-dialog/custom-dialog.component';
import { DatabaseErrorDialogComponent } from './database-error-dialog/database-error-dialog.component';
import { ImageUrlDialogComponent } from './image-url-dialog/image-url-dialog.component';
import { InstallDialogComponent } from './install-dialog/install-dialog.component';
import { LoginDialogComponent } from './login-dialog/login-dialog.component';
import { ModelLoadDialogComponent } from './model-load-dialog/model-load-dialog.component';
import { PinPromptDialogComponent } from './pin-prompt-dialog/pin-prompt-dialog.component';
import { PublishDialogComponent } from './publish-dialog/publish-dialog.component';
import { QrcodeScanDialogComponent } from './qrcode-scan-dialog/qrcode-scan-dialog.component';
import { ReactionsDialogComponent } from './reactions-dialog/reactions-dialog.component';
import { ReportDialogComponent } from './report-dialog/report-dialog.component';
import { ReportsDialogComponent } from './reports-dialog/reports-dialog.component';
import { SigningDialogComponent } from './signing-dialog/signing-dialog.component';
import { TextInputDialogComponent } from './text-input-dialog/text-input-dialog.component';

interface ComponentDef {
    onPush: boolean;
}

function getComponentDef(component: Type<unknown>): ComponentDef | null {
    return (component as unknown as Record<string, ComponentDef>)['ɵcmp'] ?? null;
}

const dialogComponents: {
    name: string;
    component: Type<unknown>;
}[] = [
    { name: 'ConfirmDialogComponent', component: ConfirmDialogComponent },
    { name: 'CustomDialogComponent', component: CustomDialogComponent },
    { name: 'DatabaseErrorDialogComponent', component: DatabaseErrorDialogComponent },
    { name: 'ImageUrlDialogComponent', component: ImageUrlDialogComponent },
    { name: 'InstallDialogComponent', component: InstallDialogComponent },
    { name: 'LoginDialogComponent', component: LoginDialogComponent },
    { name: 'ModelLoadDialogComponent', component: ModelLoadDialogComponent },
    { name: 'PinPromptDialogComponent', component: PinPromptDialogComponent },
    { name: 'PublishDialogComponent', component: PublishDialogComponent },
    { name: 'QrcodeScanDialogComponent', component: QrcodeScanDialogComponent },
    { name: 'ReactionsDialogComponent', component: ReactionsDialogComponent },
    { name: 'ReportDialogComponent', component: ReportDialogComponent },
    { name: 'ReportsDialogComponent', component: ReportsDialogComponent },
    { name: 'SigningDialogComponent', component: SigningDialogComponent },
    { name: 'TextInputDialogComponent', component: TextInputDialogComponent },
];

describe('Dialog components OnPush change detection', () => {
    for (const { name, component } of dialogComponents) {
        it(`${name} should use ChangeDetectionStrategy.OnPush`, () => {
            const def = getComponentDef(component);
            expect(def).toBeTruthy();
            expect(def!.onPush, `${name} must have changeDetection: ChangeDetectionStrategy.OnPush`).toBe(true);
        });
    }
});
