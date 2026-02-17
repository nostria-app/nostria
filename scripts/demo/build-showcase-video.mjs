import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {
  FEATURE_TAGS,
  FINAL_OUTPUT_DIR,
  RAW_OUTPUT_DIR,
  TEMP_OUTPUT_DIR,
  composeFinalVideo,
  ensureDirectories,
  hasFfmpeg,
  normalizeVideo,
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

function listRawVideos() {
  if (!fs.existsSync(RAW_OUTPUT_DIR)) {
    return [];
  }

  return fs
    .readdirSync(RAW_OUTPUT_DIR)
    .filter((name) => name.endsWith('-raw.webm'))
    .map((name) => path.join(RAW_OUTPUT_DIR, name));
}

function getLatestRawVideoForFeature(feature, device) {
  const all = listRawVideos();
  const marker = `-${sanitizeName(feature)}-${sanitizeName(device)}-raw.webm`;
  const candidates = all.filter((filePath) => filePath.toLowerCase().endsWith(marker));

  if (!candidates.length) {
    return null;
  }

  return candidates
    .map((filePath) => ({ filePath, mtime: fs.statSync(filePath).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0]?.filePath || null;
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

  if (rerun) {
    const runArgs = [
      'scripts/demo/run-demo-videos.mjs',
      '--feature',
      'all',
      '--device',
      device,
      '--compose',
      'false',
    ];

    if (introPath) {
      runArgs.push('--intro', introPath);
    }
    if (outroPath) {
      runArgs.push('--outro', outroPath);
    }

    console.log(`🎬 Capturing feature demos for showcase (${device})...`);
    run('node', runArgs);
  }

  const featuresInOrder = Object.keys(FEATURE_TAGS);
  const orderedRawVideos = [];

  for (const feature of featuresInOrder) {
    const videoPath = getLatestRawVideoForFeature(feature, device);
    if (!videoPath) {
      console.warn(`⚠ Missing raw clip for '${feature}' (${device}). Skipping it in showcase.`);
      continue;
    }
    orderedRawVideos.push({ feature, videoPath });
  }

  if (!orderedRawVideos.length) {
    throw new Error('No raw demo clips found to build showcase video.');
  }

  const normalizePrefix = `showcase-${device}-${Date.now()}`;
  const normalizedClips = [];
  const targetSize = device === 'mobile' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };

  for (const entry of orderedRawVideos) {
    const normalizedPath = path.join(
      TEMP_OUTPUT_DIR,
      `${normalizePrefix}-${sanitizeName(entry.feature)}.mp4`
    );
    normalizeVideo(entry.videoPath, normalizedPath, targetSize.width, targetSize.height);
    normalizedClips.push(normalizedPath);
  }

  const concatListPath = path.join(TEMP_OUTPUT_DIR, `${normalizePrefix}-concat-list.txt`);
  const concatListContent = normalizedClips
    .map((clipPath) => `file '${clipPath.replace(/'/g, "'\\''")}'`)
    .join('\n');
  fs.writeFileSync(concatListPath, concatListContent, 'utf8');

  const mergedBodyPath = path.join(TEMP_OUTPUT_DIR, `${normalizePrefix}-body.mp4`);
  run('ffmpeg', [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatListPath,
    '-c',
    'copy',
    mergedBodyPath,
  ]);

  const finalTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const finalPath = path.join(FINAL_OUTPUT_DIR, `${finalTimestamp}-showcase-${device}.mp4`);

  const result = composeFinalVideo({
    bodyVideoPath: mergedBodyPath,
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
