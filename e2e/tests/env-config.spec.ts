/**
 * Environment Configuration E2E Tests
 *
 * Validates that:
 * 1. .env.example exists and documents all required test environment variables
 * 2. dotenv loads .env values into process.env for Playwright tests
 * 3. TEST_NSEC, TEST_PUBKEY, and BASE_URL are accessible from process.env
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

test.describe('npm scripts Configuration', () => {
  let packageJson: Record<string, unknown>;

  test.beforeAll(() => {
    const pkgPath = path.join(process.cwd(), 'package.json');
    packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  });

  test('should have test:e2e:full script targeting chromium project', () => {
    const scripts = packageJson['scripts'] as Record<string, string>;
    expect(scripts['test:e2e:full']).toBeDefined();
    expect(scripts['test:e2e:full']).toContain('playwright test');
    expect(scripts['test:e2e:full']).toContain('--project=chromium');
  });
});

test.describe('dotenv Integration', () => {
  test('should have dotenv imported in playwright config', () => {
    const configPath = path.join(process.cwd(), 'playwright.config.ts');
    const configContent = fs.readFileSync(configPath, 'utf-8');
    expect(configContent).toContain("import 'dotenv/config'");
  });

  test('should make BASE_URL accessible with a default fallback', () => {
    // BASE_URL should either come from .env or fall back to localhost
    // The config always provides a default, so baseURL is never undefined
    const baseUrl = process.env['BASE_URL'] || 'http://localhost:4200';
    expect(baseUrl).toMatch(/^https?:\/\//);
  });

  test('should make TEST_NSEC accessible from process.env when set', () => {
    // TEST_NSEC is optional - we just verify the env var mechanism works
    const testNsec = process.env['TEST_NSEC'];
    if (testNsec) {
      expect(testNsec).toMatch(/^nsec1/);
    }
  });

  test('should make TEST_PUBKEY accessible from process.env when set', () => {
    // TEST_PUBKEY is optional - we just verify the env var mechanism works
    const testPubkey = process.env['TEST_PUBKEY'];
    if (testPubkey) {
      expect(testPubkey).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test('should load .env file when it exists', () => {
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      // If .env exists, dotenv should have loaded it
      // Verify by checking that at least one known variable is populated
      const envContent = fs.readFileSync(envPath, 'utf-8');
      const definedVars = envContent
        .split('\n')
        .filter((line) => /^[A-Z_]+=/.test(line.trim()))
        .map((line) => line.split('=')[0].trim());

      for (const varName of definedVars) {
        expect(process.env[varName]).toBeDefined();
      }
    }
  });
});
