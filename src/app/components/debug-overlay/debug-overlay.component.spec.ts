import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DebugOverlayComponent } from './debug-overlay.component';

describe('DebugOverlayComponent', () => {
  let component: DebugOverlayComponent;
  let fixture: ComponentFixture<DebugOverlayComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DebugOverlayComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DebugOverlayComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
