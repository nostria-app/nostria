import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {
  FINAL_OUTPUT_DIR,
  RAW_OUTPUT_DIR,
  composeFinalVideo,
  ensureDirectories,
  getLatestVideo,
  getNewVideos,
  hasFfmpeg,
  listVideoArtifacts,
  run,
  sanitizeName,
} from './video-utils.mjs';

function getArg(name, fallback) {
  const allIndexes = process.argv
    .map((value, index) => ({ value, index }))
    .filter((entry) => entry.value === name)
    .map((entry) => entry.index);

  if (!allIndexes.length) {
    return fallback;
  }

  const index = allIndexes[allIndexes.length - 1];
  if (index >= process.argv.length - 1) {
    return fallback;
  }

  return process.argv[index + 1];
}

function getOptionalPath(name) {
  const value = getArg(name, '');
  return value ? path.resolve(value) : null;
}

function copyRawVideo(videoPath, device) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}-showcase-${sanitizeName(device)}-raw.webm`;
  const destination = path.join(RAW_OUTPUT_DIR, filename);
  fs.copyFileSync(videoPath, destination);
  return destination;
}

function findLatestShowcaseArtifact(device) {
  const marker = `demo-${sanitizeName(device)}`;
  const candidates = listVideoArtifacts().filter((filePath) => {
    const lower = filePath.toLowerCase();
    return lower.includes('demo-showcase') && lower.includes(marker);
  });

  return getLatestVideo(candidates);
}

async function main() {
  const device = getArg('--device', 'desktop');
  if (device !== 'desktop' && device !== 'mobile') {
    throw new Error(`Unsupported device '${device}'. Use desktop or mobile.`);
  }

  const introPath = getOptionalPath('--intro');
  const outroPath = getOptionalPath('--outro');
  const rerun = getArg('--rerun', 'true') !== 'false';

  ensureDirectories();

  if (!hasFfmpeg()) {
    throw new Error('ffmpeg/ffprobe is required for showcase video generation.');
  }

  let bodyVideoPath = null;

  if (rerun) {
    const project = device === 'mobile' ? 'demo-mobile' : 'demo-desktop';
    const warmupProject = device === 'mobile' ? 'mobile-chrome' : 'chromium';

    console.log(`🔥 Warmup before recording (${device})...`);
    run('npx', [
      'playwright',
      'test',
      'e2e/tests/demo/demo-showcase-warmup.spec.ts',
      '--project',
      warmupProject,
      '--grep',
      '@demo-showcase-warmup',
    ]);

    const beforeRunVideos = listVideoArtifacts();

    console.log(`🎬 Recording single-session showcase (${device})...`);
    run('npx', [
      'playwright',
      'test',
      'e2e/tests/demo/demo-showcase.spec.ts',
      '--project',
      project,
      '--grep',
      '@demo-showcase',
    ]);

    const newVideos = getNewVideos(beforeRunVideos);
    bodyVideoPath = getLatestVideo(newVideos) || findLatestShowcaseArtifact(device);
  } else {
    const previousShowcaseRaws = fs.existsSync(RAW_OUTPUT_DIR)
      ? fs
        .readdirSync(RAW_OUTPUT_DIR)
        .filter((name) => name.endsWith(`-showcase-${sanitizeName(device)}-raw.webm`))
        .map((name) => path.join(RAW_OUTPUT_DIR, name))
      : [];

    bodyVideoPath = getLatestVideo(previousShowcaseRaws) || findLatestShowcaseArtifact(device);
  }

  if (!bodyVideoPath) {
    throw new Error('No showcase body video found. Run with --rerun true to record a fresh showcase.');
  }

  const rawPath = copyRawVideo(bodyVideoPath, device);
  console.log(`📼 Showcase raw video: ${rawPath}`);

  const finalTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const finalPath = path.join(FINAL_OUTPUT_DIR, `${finalTimestamp}-showcase-${device}.mp4`);

  const result = composeFinalVideo({
    bodyVideoPath,
    finalOutputPath: finalPath,
    introPath,
    outroPath,
    feature: 'showcase',
    device,
  });

  console.log(`✅ Showcase video created: ${result.outputPath}`);
}

main().catch((error) => {
  console.error(`❌ Showcase generation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
