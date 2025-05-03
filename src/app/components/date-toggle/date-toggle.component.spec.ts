import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DateToggleComponent } from './date-toggle.component';

describe('DateToggleComponent', () => {
  let component: DateToggleComponent;
  let fixture: ComponentFixture<DateToggleComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DateToggleComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DateToggleComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
