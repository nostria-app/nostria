import { UtilitiesService } from './utilities.service';

describe('UtilitiesService Event Classification', () => {
  let service: UtilitiesService;

  beforeEach(() => {
    // Create a minimal service instance for testing event classification methods
    service = new UtilitiesService();
  });

  describe('isReplaceableEvent', () => {
    it('should identify metadata events (kind 0) as replaceable', () => {
      expect(service.isReplaceableEvent(0)).toBe(true);
    });

    it('should identify contact lists (kind 3) as replaceable', () => {
      expect(service.isReplaceableEvent(3)).toBe(true);
    });

    it('should identify events in 10000-19999 range as replaceable', () => {
      expect(service.isReplaceableEvent(10000)).toBe(true);
      expect(service.isReplaceableEvent(15000)).toBe(true);
      expect(service.isReplaceableEvent(19999)).toBe(true);
    });

    it('should identify regular short text notes (kind 1) as non-replaceable', () => {
      expect(service.isReplaceableEvent(1)).toBe(false);
    });

    it('should identify kind 7 (reactions) as non-replaceable', () => {
      expect(service.isReplaceableEvent(7)).toBe(false);
    });

    it('should identify ephemeral events as non-replaceable', () => {
      expect(service.isReplaceableEvent(20000)).toBe(false);
      expect(service.isReplaceableEvent(25000)).toBe(false);
    });
  });

  describe('isParameterizedReplaceableEvent', () => {
    it('should identify articles (kind 30023) as parameterized replaceable', () => {
      expect(service.isParameterizedReplaceableEvent(30023)).toBe(true);
    });

    it('should identify events in 30000-39999 range as parameterized replaceable', () => {
      expect(service.isParameterizedReplaceableEvent(30000)).toBe(true);
      expect(service.isParameterizedReplaceableEvent(35000)).toBe(true);
      expect(service.isParameterizedReplaceableEvent(39999)).toBe(true);
    });

    it('should identify regular events as non-parameterized replaceable', () => {
      expect(service.isParameterizedReplaceableEvent(1)).toBe(false);
      expect(service.isParameterizedReplaceableEvent(0)).toBe(false);
    });

    it('should identify kind 40000 as non-parameterized replaceable (out of range)', () => {
      expect(service.isParameterizedReplaceableEvent(40000)).toBe(false);
    });
  });

  describe('shouldAlwaysFetchFromRelay', () => {
    it('should return true for metadata (kind 0)', () => {
      expect(service.shouldAlwaysFetchFromRelay(0)).toBe(true);
    });

    it('should return true for contact lists (kind 3)', () => {
      expect(service.shouldAlwaysFetchFromRelay(3)).toBe(true);
    });

    it('should return true for replaceable events (10000-19999)', () => {
      expect(service.shouldAlwaysFetchFromRelay(10002)).toBe(true);
    });

    it('should return true for parameterized replaceable events (30000-39999)', () => {
      expect(service.shouldAlwaysFetchFromRelay(30023)).toBe(true);
    });

    it('should return false for regular short text notes (kind 1)', () => {
      expect(service.shouldAlwaysFetchFromRelay(1)).toBe(false);
    });

    it('should return false for reactions (kind 7)', () => {
      expect(service.shouldAlwaysFetchFromRelay(7)).toBe(false);
    });

    it('should return false for reposts (kind 6)', () => {
      expect(service.shouldAlwaysFetchFromRelay(6)).toBe(false);
    });

    it('should return false for ephemeral events', () => {
      expect(service.shouldAlwaysFetchFromRelay(20000)).toBe(false);
    });
  });
});
