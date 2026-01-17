/**
 * Global Setup for Playwright Tests
 *
 * This file runs once before all tests and can be used for:
 * - Setting up test data
 * - Creating test accounts
 * - Configuring environment
 */
import { FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

async function globalSetup(config: FullConfig): Promise<void> {
  console.log('🚀 Starting Playwright global setup...');

  // Ensure test-results directory exists
  const resultsDir = path.join(process.cwd(), 'test-results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  // Create subdirectories for artifacts
  const dirs = ['screenshots', 'videos', 'traces', 'logs', 'artifacts'];
  for (const dir of dirs) {
    const dirPath = path.join(resultsDir, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  // Write test run metadata for AI analysis
  const metadata = {
    startTime: new Date().toISOString(),
    baseURL: config.projects[0]?.use?.baseURL || 'http://localhost:4200',
    projects: config.projects.map((p) => p.name),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      ci: !!process.env['CI'],
    },
  };

  fs.writeFileSync(
    path.join(resultsDir, 'test-run-metadata.json'),
    JSON.stringify(metadata, null, 2)
  );

  console.log('✅ Global setup complete');
}

export default globalSetup;
