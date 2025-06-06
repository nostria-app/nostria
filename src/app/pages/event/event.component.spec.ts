import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EventPageComponent } from './event.component';

describe('EventComponent', () => {
  let component: EventPageComponent;
  let fixture: ComponentFixture<EventPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EventPageComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(EventPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
