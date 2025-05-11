import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SocialPreviewComponent } from './social-preview.component';

describe('SocialPreviewComponent', () => {
  let component: SocialPreviewComponent;
  let fixture: ComponentFixture<SocialPreviewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SocialPreviewComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SocialPreviewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
