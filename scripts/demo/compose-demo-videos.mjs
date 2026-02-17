import path from 'node:path';
import {
  FINAL_OUTPUT_DIR,
  FEATURE_TAGS,
  composeFinalVideo,
  ensureDirectories,
  hasFfmpeg,
  listVideoArtifacts,
  sanitizeName,
} from './video-utils.mjs';

function getArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return fallback;
  }

  return process.argv[index + 1];
}

function inferFeatureFromPath(videoPath) {
  const lower = videoPath.toLowerCase();

  for (const [feature, tag] of Object.entries(FEATURE_TAGS)) {
    const normalizedTag = tag.replace('@', '').toLowerCase();
    if (lower.includes(normalizedTag) || lower.includes(feature)) {
      return feature;
    }
  }

  return 'unknown';
}

function inferDeviceFromPath(videoPath) {
  const lower = videoPath.toLowerCase();
  if (lower.includes('demo-mobile')) {
    return 'mobile';
  }

  return 'desktop';
}

async function main() {
  const featureFilter = getArg('--feature', 'all');
  const deviceFilter = getArg('--device', 'both');
  const introPath = getArg('--intro', '');
  const outroPath = getArg('--outro', '');

  ensureDirectories();

  if (!hasFfmpeg()) {
    throw new Error('ffmpeg/ffprobe is required for composition. Please install ffmpeg first.');
  }

  const videos = listVideoArtifacts();
  if (!videos.length) {
    console.log('No Playwright video artifacts found under test-results/artifacts.');
    return;
  }

  let composed = 0;

  for (const videoPath of videos) {
    const feature = inferFeatureFromPath(videoPath);
    const device = inferDeviceFromPath(videoPath);

    if (featureFilter !== 'all' && feature !== featureFilter) {
      continue;
    }

    if (deviceFilter !== 'both' && device !== deviceFilter) {
      continue;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputName = `${timestamp}-${sanitizeName(feature)}-${sanitizeName(device)}.mp4`;
    const outputPath = path.join(FINAL_OUTPUT_DIR, outputName);

    const result = composeFinalVideo({
      bodyVideoPath: videoPath,
      finalOutputPath: outputPath,
      introPath: introPath || null,
      outroPath: outroPath || null,
      feature,
      device,
    });

    composed += 1;
    console.log(`✅ Composed: ${result.outputPath}`);
  }

  if (composed === 0) {
    console.log('No videos matched filters; nothing composed.');
  }
}

main().catch((error) => {
  console.error(`❌ Composition failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
