import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MessagesList } from './list';

describe('MessagesList', () => {
  let component: MessagesList;
  let fixture: ComponentFixture<MessagesList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MessagesList],
    }).compileComponents();

    fixture = TestBed.createComponent(MessagesList);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
