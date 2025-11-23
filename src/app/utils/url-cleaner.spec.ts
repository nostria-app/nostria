import {
  removeTrackingParameters,
  cleanTrackingParametersFromText,
  hasTrackingParameters,
} from './url-cleaner';

describe('URL Cleaner Utility', () => {
  describe('removeTrackingParameters', () => {
    it('should remove Google Analytics UTM parameters', () => {
      const input = 'https://example.com/page?utm_source=google&utm_medium=cpc&utm_campaign=test';
      const expected = 'https://example.com/page';
      expect(removeTrackingParameters(input)).toBe(expected);
    });

    it('should remove Facebook fbclid parameter', () => {
      const input = 'https://example.com/page?fbclid=IwAR123456';
      const expected = 'https://example.com/page';
      expect(removeTrackingParameters(input)).toBe(expected);
    });

    it('should remove Google Ads gclid parameter', () => {
      const input = 'https://example.com/page?gclid=CjwKCAjw';
      const expected = 'https://example.com/page';
      expect(removeTrackingParameters(input)).toBe(expected);
    });

    it('should remove YouTube tracking parameters', () => {
      const input = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc123&feature=share';
      const expected = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      expect(removeTrackingParameters(input)).toBe(expected);
    });

    it('should remove Twitter/X tracking parameters', () => {
      const input = 'https://twitter.com/user/status/123?s=20&t=abc123';
      const expected = 'https://twitter.com/user/status/123';
      expect(removeTrackingParameters(input)).toBe(expected);
    });

    it('should preserve non-tracking parameters', () => {
      const input = 'https://example.com/search?q=test&page=2';
      const expected = 'https://example.com/search?q=test&page=2';
      expect(removeTrackingParameters(input)).toBe(expected);
    });

    it('should handle mixed tracking and non-tracking parameters', () => {
      const input = 'https://example.com/page?id=123&utm_source=google&name=test';
      const expected = 'https://example.com/page?id=123&name=test';
      expect(removeTrackingParameters(input)).toBe(expected);
    });

    it('should handle URLs without query parameters', () => {
      const input = 'https://example.com/page';
      const expected = 'https://example.com/page';
      expect(removeTrackingParameters(input)).toBe(expected);
    });

    it('should handle URLs with hash fragments', () => {
      const input = 'https://example.com/page?utm_source=google#section';
      const expected = 'https://example.com/page#section';
      expect(removeTrackingParameters(input)).toBe(expected);
    });

    it('should return original URL if parsing fails', () => {
      const input = 'not-a-valid-url';
      expect(removeTrackingParameters(input)).toBe(input);
    });

    it('should remove multiple tracking parameters from different platforms', () => {
      const input =
        'https://example.com/page?utm_source=google&fbclid=abc&gclid=xyz&msclkid=123';
      const expected = 'https://example.com/page';
      expect(removeTrackingParameters(input)).toBe(expected);
    });
  });

  describe('cleanTrackingParametersFromText', () => {
    it('should clean single URL in text', () => {
      const input = 'Check this out: https://example.com/page?utm_source=google';
      const expected = 'Check this out: https://example.com/page';
      expect(cleanTrackingParametersFromText(input)).toBe(expected);
    });

    it('should clean multiple URLs in text', () => {
      const input =
        'Links: https://example.com/page?utm_source=google and https://test.com/?fbclid=abc123';
      const expected = 'Links: https://example.com/page and https://test.com/';
      expect(cleanTrackingParametersFromText(input)).toBe(expected);
    });

    it('should preserve text without URLs', () => {
      const input = 'This is just plain text without any URLs';
      expect(cleanTrackingParametersFromText(input)).toBe(input);
    });

    it('should handle text with mixed URLs (some with tracking, some without)', () => {
      const input =
        'Visit https://example.com/page?utm_source=google or https://clean.com/page';
      const expected = 'Visit https://example.com/page or https://clean.com/page';
      expect(cleanTrackingParametersFromText(input)).toBe(expected);
    });

    it('should handle URLs with trailing punctuation', () => {
      const input = 'Check out https://example.com/page?utm_source=google.';
      const expected = 'Check out https://example.com/page.';
      expect(cleanTrackingParametersFromText(input)).toBe(expected);
    });

    it('should handle URLs with trailing commas', () => {
      const input = 'Links: https://example.com/page?utm_source=google, https://test.com/';
      const expected = 'Links: https://example.com/page, https://test.com/';
      expect(cleanTrackingParametersFromText(input)).toBe(expected);
    });

    it('should handle URLs in parentheses', () => {
      const input = 'See (https://example.com/page?utm_source=google) for more info';
      const expected = 'See (https://example.com/page) for more info';
      expect(cleanTrackingParametersFromText(input)).toBe(expected);
    });
  });

  describe('hasTrackingParameters', () => {
    it('should return true for URLs with UTM parameters', () => {
      const url = 'https://example.com/page?utm_source=google';
      expect(hasTrackingParameters(url)).toBe(true);
    });

    it('should return true for URLs with fbclid', () => {
      const url = 'https://example.com/page?fbclid=abc123';
      expect(hasTrackingParameters(url)).toBe(true);
    });

    it('should return false for URLs without tracking parameters', () => {
      const url = 'https://example.com/page?id=123&name=test';
      expect(hasTrackingParameters(url)).toBe(false);
    });

    it('should return false for invalid URLs', () => {
      const url = 'not-a-valid-url';
      expect(hasTrackingParameters(url)).toBe(false);
    });

    it('should return false for URLs without query parameters', () => {
      const url = 'https://example.com/page';
      expect(hasTrackingParameters(url)).toBe(false);
    });
  });

  describe('Real-world URL examples', () => {
    it('should clean YouTube share links', () => {
      const input =
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=nw7XH8cM4E5kqPw_&feature=youtu.be';
      const expected = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      expect(removeTrackingParameters(input)).toBe(expected);
    });

    it('should clean Facebook links with fbclid', () => {
      const input =
        'https://www.facebook.com/username/posts/123456?fbclid=IwAR3xYz123_ABC-def456';
      const expected = 'https://www.facebook.com/username/posts/123456';
      expect(removeTrackingParameters(input)).toBe(expected);
    });

    it('should clean Twitter share links', () => {
      const input = 'https://twitter.com/user/status/1234567890?s=20&t=abc123def456';
      const expected = 'https://twitter.com/user/status/1234567890';
      expect(removeTrackingParameters(input)).toBe(expected);
    });

    it('should clean Google search results with tracking', () => {
      const input =
        'https://www.example.com/article?utm_source=google&utm_medium=organic&utm_campaign=blog';
      const expected = 'https://www.example.com/article';
      expect(removeTrackingParameters(input)).toBe(expected);
    });

    it('should clean LinkedIn links', () => {
      const input = 'https://www.linkedin.com/feed/update/urn:li:activity:123?trk=public_profile';
      const expected = 'https://www.linkedin.com/feed/update/urn:li:activity:123';
      expect(removeTrackingParameters(input)).toBe(expected);
    });
  });
});
