/**
 * Environment Configuration E2E Tests
 *
 * Validates that .env.example exists and documents all required
 * test environment variables with correct format.
 */
import { test, expect } from '../fixtures';
import * as fs from 'fs';
import * as path from 'path';

const ENV_EXAMPLE_PATH = path.join(process.cwd(), '.env.example');

test.describe('Environment Configuration', () => {
  let envContent: string;

  test.beforeAll(() => {
    envContent = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf-8');
  });

  test('should have .env.example file in project root', () => {
    expect(fs.existsSync(ENV_EXAMPLE_PATH)).toBe(true);
  });

  test('should document TEST_NSEC variable', () => {
    expect(envContent).toContain('TEST_NSEC');
    expect(envContent).toContain('nsec1');
  });

  test('should document TEST_PUBKEY variable', () => {
    expect(envContent).toContain('TEST_PUBKEY');
    // Should mention auto-derivation
    expect(envContent).toMatch(/derived|omit/i);
  });

  test('should document BASE_URL variable with default', () => {
    expect(envContent).toContain('BASE_URL');
    expect(envContent).toContain('http://localhost:4200');
  });

  test('should document TEST_LOG_LEVEL variable with valid options', () => {
    expect(envContent).toContain('TEST_LOG_LEVEL');
    expect(envContent).toContain('debug');
    expect(envContent).toContain('info');
    expect(envContent).toContain('warn');
    expect(envContent).toContain('error');
  });

  test('should document CI variable', () => {
    expect(envContent).toContain('CI');
    // Should describe what CI affects
    expect(envContent).toMatch(/retries|worker/i);
  });

  test('should have all values commented out by default', () => {
    // Extract lines that look like variable assignments (KEY=value)
    const lines = envContent.split('\n');
    const assignmentLines = lines.filter((line) => {
      const trimmed = line.trim();
      // Match lines with variable assignments, skip pure comments and blanks
      return /^#?[A-Z_]+=/.test(trimmed);
    });

    // Every assignment should be commented out
    for (const line of assignmentLines) {
      expect(line.trim().startsWith('#')).toBe(true);
    }
  });
});
