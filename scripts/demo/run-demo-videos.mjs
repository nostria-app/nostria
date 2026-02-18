import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEVICE_PROJECTS,
  FEATURE_TAGS,
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

const AUTH_FEATURES = ['collections', 'notifications', 'messages', 'article-editor'];

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

function getDeviceList(deviceArg) {
  if (deviceArg === 'both') {
    return ['desktop', 'mobile'];
  }

  if (deviceArg === 'desktop' || deviceArg === 'mobile') {
    return [deviceArg];
  }

  throw new Error(`Unsupported device '${deviceArg}'. Use desktop, mobile, or both.`);
}

function getFeatureList(featureArg) {
  if (featureArg === 'all') {
    return Object.keys(FEATURE_TAGS);
  }

  if (featureArg === 'auth') {
    return AUTH_FEATURES;
  }

  if (!Object.prototype.hasOwnProperty.call(FEATURE_TAGS, featureArg)) {
    throw new Error(
      `Unknown feature '${featureArg}'. Valid features: ${Object.keys(FEATURE_TAGS).join(', ')}, all, auth`
    );
  }

  return [featureArg];
}

function shouldCompose() {
  const value = getArg('--compose', 'true');
  return value !== 'false';
}

function getOptionalPath(name) {
  const value = getArg(name, '');
  if (!value) {
    return null;
  }

  return path.resolve(value);
}

function copyRawVideo(videoPath, feature, device) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}-${sanitizeName(feature)}-${sanitizeName(device)}-raw.webm`;
  const destination = path.join(RAW_OUTPUT_DIR, filename);
  fs.copyFileSync(videoPath, destination);
  return destination;
}

function isAuthFeature(feature) {
  return feature === 'article-editor' || feature === 'notifications' || feature === 'messages';
}

async function main() {
  const featureArg = getArg('--feature', 'all');
  const deviceArg = getArg('--device', 'both');
  const composeEnabled = shouldCompose();

  const introPath = getOptionalPath('--intro');
  const outroPath = getOptionalPath('--outro');

  const features = getFeatureList(featureArg);
  const devices = getDeviceList(deviceArg);

  ensureDirectories();

  const hasTestNsec = Boolean(process.env['TEST_NSEC']);

  if (composeEnabled && !hasFfmpeg()) {
    throw new Error('ffmpeg/ffprobe is required for composition. Install ffmpeg or run with --compose false.');
  }

  for (const feature of features) {
    for (const device of devices) {
      if (isAuthFeature(feature) && !hasTestNsec) {
        throw new Error(
          `Feature '${feature}' requires TEST_NSEC in .env for deterministic auth demo videos.`
        );
      }

      const project = DEVICE_PROJECTS[device];
      const grepTag = FEATURE_TAGS[feature];

      const beforeRunVideos = listVideoArtifacts();
      const runStartedAtMs = Date.now();

      console.log(`\n🎬 Running demo for feature='${feature}' device='${device}' project='${project}'`);
      run('npx', [
        'playwright',
        'test',
        'e2e/tests/demo/demo-features.spec.ts',
        '--project',
        project,
        '--grep',
        grepTag,
      ]);

      const newVideos = getNewVideos(beforeRunVideos, runStartedAtMs);
      const latestVideo = getLatestVideo(newVideos);

      if (!latestVideo) {
        console.warn(`⚠️  No new video found for feature='${feature}' device='${device}'.`);
        continue;
      }

      const rawPath = copyRawVideo(latestVideo, feature, device);
      console.log(`📼 Raw video: ${rawPath}`);

      if (composeEnabled) {
        const finalTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const finalName = `${finalTimestamp}-${sanitizeName(feature)}-${sanitizeName(device)}.mp4`;
        const finalPath = path.join(FINAL_OUTPUT_DIR, finalName);

        const result = composeFinalVideo({
          bodyVideoPath: latestVideo,
          finalOutputPath: finalPath,
          introPath,
          outroPath,
          feature,
          device,
        });

        console.log(`✅ Final video: ${result.outputPath}`);
      }
    }
  }
}

main().catch((error) => {
  console.error(`❌ Demo generation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
