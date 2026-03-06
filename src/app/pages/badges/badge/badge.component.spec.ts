import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { BadgeComponent } from './badge.component';
import { BadgeService } from '../../../services/badge.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { LoggerService } from '../../../services/logger.service';

describe('BadgeComponent', () => {
    let component: BadgeComponent;
    let fixture: ComponentFixture<BadgeComponent>;

    const mockBadgeService = {
        getBadgeDefinition: vi.fn().mockReturnValue(undefined),
        loadBadgeDefinition: vi.fn().mockResolvedValue(null),
        parseDefinition: vi.fn().mockReturnValue({
            slug: 'test',
            name: 'Test Badge',
            description: 'A test badge',
            image: '',
            thumb: '',
            tags: [],
        }),
    };

    const mockUtilitiesService = {
        getATagValueFromEvent: vi.fn().mockReturnValue(null),
    };

    const mockLoggerService = {
        error: vi.fn(),
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [BadgeComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: BadgeService, useValue: mockBadgeService },
                { provide: UtilitiesService, useValue: mockUtilitiesService },
                { provide: LoggerService, useValue: mockLoggerService },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(BadgeComponent);
        component = fixture.componentInstance;
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('outputs', () => {
        it('should emit acceptClicked when onAccept is called', () => {
            const spy = vi.fn();
            component.acceptClicked.subscribe(spy);

            const event = new MouseEvent('click');
            vi.spyOn(event, 'stopPropagation');

            component.onAccept(event);

            expect(event.stopPropagation).toHaveBeenCalled();
            expect(spy).toHaveBeenCalled();
        });

        it('should emit viewClicked when onView is called', () => {
            const spy = vi.fn();
            component.viewClicked.subscribe(spy);

            const event = new MouseEvent('click');
            vi.spyOn(event, 'stopPropagation');

            component.onView(event);

            expect(event.stopPropagation).toHaveBeenCalled();
            expect(spy).toHaveBeenCalled();
        });

        it('should emit removeClicked when onRemove is called', () => {
            const spy = vi.fn();
            component.removeClicked.subscribe(spy);

            const event = new MouseEvent('click');
            vi.spyOn(event, 'stopPropagation');

            component.onRemove(event);

            expect(event.stopPropagation).toHaveBeenCalled();
            expect(spy).toHaveBeenCalled();
        });
    });
});
