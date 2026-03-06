import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MessagesMain } from './main';

describe('MessagesMain', () => {
  let component: MessagesMain;
  let fixture: ComponentFixture<MessagesMain>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MessagesMain],
    }).compileComponents();

    fixture = TestBed.createComponent(MessagesMain);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
