/**
 * Global Teardown for Playwright Tests
 *
 * This file runs once after all tests complete and can be used for:
 * - Cleaning up test data
 * - Generating summary reports
 * - Collecting final metrics
 */
import * as fs from 'fs';
import * as path from 'path';

async function globalTeardown(): Promise<void> {
  console.log('🧹 Starting Playwright global teardown...');

  const resultsDir = path.join(process.cwd(), 'test-results');

  // Read the results.json if it exists
  const resultsPath = path.join(resultsDir, 'results.json');
  if (fs.existsSync(resultsPath)) {
    try {
      const results = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));

      // Generate AI-friendly summary
      const summary = {
        endTime: new Date().toISOString(),
        totalTests: results.stats?.expected || 0,
        passed: results.stats?.expected || 0,
        failed: results.stats?.unexpected || 0,
        skipped: results.stats?.skipped || 0,
        duration: results.stats?.duration || 0,
        // Extract failed test names for quick AI analysis
        failedTests: results.suites
          ?.flatMap((suite: { specs: { ok: boolean; title: string }[] }) =>
            suite.specs.filter((spec: { ok: boolean }) => !spec.ok).map((spec: { title: string }) => spec.title)
          )
          .filter(Boolean) || [],
      };

      fs.writeFileSync(
        path.join(resultsDir, 'test-summary.json'),
        JSON.stringify(summary, null, 2)
      );

      console.log(`📊 Test Summary: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped`);
    } catch (error) {
      console.warn('Could not parse test results:', error);
    }
  }

  console.log('✅ Global teardown complete');
}

export default globalTeardown;
