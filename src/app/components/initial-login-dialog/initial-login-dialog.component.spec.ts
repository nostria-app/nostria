import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InitialLoginDialogComponent } from './initial-login-dialog.component';

describe('InitialLoginDialogComponent', () => {
  let component: InitialLoginDialogComponent;
  let fixture: ComponentFixture<InitialLoginDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InitialLoginDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(InitialLoginDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
