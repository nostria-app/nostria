import { MentionInputService } from './mention-input.service';

describe('MentionInputService', () => {
  let service: MentionInputService;

  beforeEach(() => {
    service = new MentionInputService();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('sanitizeDisplayName', () => {
    it('should replace whitespace with underscores', () => {
      expect(service.sanitizeDisplayName('John Doe')).toBe('John_Doe');
    });

    it('should collapse multiple spaces into single underscore', () => {
      expect(service.sanitizeDisplayName('John   Doe')).toBe('John_Doe');
    });

    it('should strip straight apostrophes', () => {
      expect(service.sanitizeDisplayName("Nat_'Atlas'_Cole")).toBe('Nat_Atlas_Cole');
    });

    it('should strip smart single quotes (left)', () => {
      expect(service.sanitizeDisplayName('Nat_\u2018Atlas\u2019_Cole')).toBe('Nat_Atlas_Cole');
    });

    it('should strip smart single quotes (right)', () => {
      expect(service.sanitizeDisplayName('name\u2019s')).toBe('names');
    });

    it('should strip straight double quotes', () => {
      expect(service.sanitizeDisplayName('The "Best" User')).toBe('The_Best_User');
    });

    it('should strip smart double quotes', () => {
      expect(service.sanitizeDisplayName('The \u201CBest\u201D User')).toBe('The_Best_User');
    });

    it('should strip backticks', () => {
      expect(service.sanitizeDisplayName('user`name')).toBe('username');
    });

    it('should strip acute accent', () => {
      expect(service.sanitizeDisplayName('user\u00B4name')).toBe('username');
    });

    it('should strip regex metacharacters', () => {
      expect(service.sanitizeDisplayName('user.*+?^${}()|[]\\name')).toBe('username');
    });

    it('should strip @ symbol', () => {
      expect(service.sanitizeDisplayName('@username')).toBe('username');
    });

    it('should strip # symbol', () => {
      expect(service.sanitizeDisplayName('#username')).toBe('username');
    });

    it('should strip ! symbol', () => {
      expect(service.sanitizeDisplayName('hello!')).toBe('hello');
    });

    it('should strip < > symbols', () => {
      expect(service.sanitizeDisplayName('<user>')).toBe('user');
    });

    it('should strip comma and semicolon', () => {
      expect(service.sanitizeDisplayName('first,last;ok')).toBe('firstlastok');
    });

    it('should strip colon', () => {
      expect(service.sanitizeDisplayName('user:name')).toBe('username');
    });

    it('should strip tilde', () => {
      expect(service.sanitizeDisplayName('~user~')).toBe('user');
    });

    it('should preserve hyphens', () => {
      expect(service.sanitizeDisplayName('user-name')).toBe('user-name');
    });

    it('should preserve dots', () => {
      expect(service.sanitizeDisplayName('user.name')).toBe('user.name');
    });

    it('should preserve digits', () => {
      expect(service.sanitizeDisplayName('user123')).toBe('user123');
    });

    it('should preserve Unicode letters (accented)', () => {
      expect(service.sanitizeDisplayName('caf\u00E9')).toBe('caf\u00E9');
    });

    it('should preserve Unicode letters (CJK)', () => {
      expect(service.sanitizeDisplayName('\u65E5\u672C\u8A9E')).toBe('\u65E5\u672C\u8A9E');
    });

    it('should preserve Unicode letters (Cyrillic)', () => {
      expect(service.sanitizeDisplayName('\u0410\u043B\u0435\u043A\u0441')).toBe('\u0410\u043B\u0435\u043A\u0441');
    });

    it('should collapse consecutive underscores', () => {
      expect(service.sanitizeDisplayName('hello__world')).toBe('hello_world');
    });

    it('should strip leading underscores', () => {
      expect(service.sanitizeDisplayName('_username')).toBe('username');
    });

    it('should strip trailing underscores', () => {
      expect(service.sanitizeDisplayName('username_')).toBe('username');
    });

    it('should strip both leading and trailing underscores', () => {
      expect(service.sanitizeDisplayName('_username_')).toBe('username');
    });

    it('should handle name with spaces and apostrophes', () => {
      expect(service.sanitizeDisplayName("Nat 'Atlas' Cole")).toBe('Nat_Atlas_Cole');
    });

    it('should handle name with parentheses', () => {
      expect(service.sanitizeDisplayName('Name (nickname) Surname')).toBe('Name_nickname_Surname');
    });

    it('should return "user" for empty string', () => {
      expect(service.sanitizeDisplayName('')).toBe('user');
    });

    it('should return "user" for whitespace-only string', () => {
      expect(service.sanitizeDisplayName('   ')).toBe('user');
    });

    it('should return "user" when all characters are stripped', () => {
      expect(service.sanitizeDisplayName("'")).toBe('user');
    });

    it('should return "user" when only special characters remain', () => {
      expect(service.sanitizeDisplayName('!!!@@@###')).toBe('user');
    });

    it('should handle complex real-world name with mixed special chars', () => {
      expect(service.sanitizeDisplayName("Nat 'Atlas' Cole!")).toBe('Nat_Atlas_Cole');
    });

    it('should handle underscores from whitespace replacement before stripping', () => {
      // "Name 'X' Y" -> "Name_'X'_Y" -> "Name_X_Y"
      expect(service.sanitizeDisplayName("Name 'X' Y")).toBe('Name_X_Y');
    });

    it('should handle simple underscore name', () => {
      expect(service.sanitizeDisplayName('simple_name')).toBe('simple_name');
    });

    it('should handle PascalCase name', () => {
      expect(service.sanitizeDisplayName('JohnDoe')).toBe('JohnDoe');
    });
  });

  describe('detectMention', () => {
    it('should detect mention at start of text', () => {
      const result = service.detectMention('@john', 5);
      expect(result.isTypingMention).toBe(true);
      expect(result.query).toBe('john');
      expect(result.mentionStart).toBe(0);
    });

    it('should detect mention after whitespace', () => {
      const result = service.detectMention('hello @john', 11);
      expect(result.isTypingMention).toBe(true);
      expect(result.query).toBe('john');
      expect(result.mentionStart).toBe(6);
    });

    it('should not detect mention without @ symbol', () => {
      const result = service.detectMention('hello john', 10);
      expect(result.isTypingMention).toBe(false);
    });

    it('should not detect mention when @ is not preceded by whitespace', () => {
      const result = service.detectMention('email@john', 10);
      expect(result.isTypingMention).toBe(false);
    });

    it('should stop scanning at whitespace', () => {
      const result = service.detectMention('hello world @jo', 15);
      expect(result.isTypingMention).toBe(true);
      expect(result.query).toBe('jo');
    });
  });

  describe('replaceMention', () => {
    it('should replace mention with URI and add trailing space', () => {
      const detection = service.detectMention('@john', 5);
      const result = service.replaceMention(detection, '@JohnDoe');
      expect(result.replacementText).toBe('@JohnDoe ');
      expect(result.newCursorPosition).toBe(9);
    });

    it('should replace mention in middle of text', () => {
      const detection = service.detectMention('hello @jo world', 9);
      const result = service.replaceMention(detection, '@JohnDoe');
      expect(result.replacementText).toBe('hello @JohnDoe world');
    });
  });
});
