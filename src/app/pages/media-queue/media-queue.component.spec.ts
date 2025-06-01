import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MediaQueueComponent } from './media-queue.component';

describe('MediaQueueComponent', () => {
  let component: MediaQueueComponent;
  let fixture: ComponentFixture<MediaQueueComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MediaQueueComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MediaQueueComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
