import { copyFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const browserDistDir = join(process.cwd(), 'dist', 'app', 'browser');
const sourceIndexPath = join(browserDistDir, 'index.csr.html');
const targetIndexPath = join(browserDistDir, 'index.html');

try {
  const sourceStats = await stat(sourceIndexPath);
  if (!sourceStats.isFile()) {
    throw new Error('index.csr.html exists but is not a file.');
  }

  await copyFile(sourceIndexPath, targetIndexPath);
  console.log('[prepare-tauri-dist] Copied index.csr.html to index.html for Tauri packaging.');
} catch (error) {
  console.error('[prepare-tauri-dist] Failed to prepare Tauri frontend dist.', error);
  process.exitCode = 1;
}