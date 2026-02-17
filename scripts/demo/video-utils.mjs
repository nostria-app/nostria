import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const ROOT_DIR = process.cwd();
export const ARTIFACTS_DIR = path.join(ROOT_DIR, 'test-results', 'artifacts');
export const RAW_OUTPUT_DIR = path.join(ROOT_DIR, 'test-results', 'demo-videos', 'raw');
export const FINAL_OUTPUT_DIR = path.join(ROOT_DIR, 'test-results', 'demo-videos', 'final');
export const TEMP_OUTPUT_DIR = path.join(ROOT_DIR, 'test-results', 'demo-videos', 'temp');

export const FEATURE_TAGS = {
  summary: '@demo-summary',
  music: '@demo-music',
  articles: '@demo-articles',
  search: '@demo-search',
  streams: '@demo-streams',
  discover: '@demo-discover',
  profile: '@demo-profile',
  collections: '@demo-collections',
  notifications: '@demo-notifications',
  messages: '@demo-messages',
  'article-editor': '@demo-article-editor',
};

export const DEVICE_PROJECTS = {
  desktop: 'demo-desktop',
  mobile: 'demo-mobile',
};

export function ensureDirectories() {
  for (const dir of [RAW_OUTPUT_DIR, FINAL_OUTPUT_DIR, TEMP_OUTPUT_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });

  if (typeof result.status !== 'number' || result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function walkFilesRecursive(directory, result = []) {
  if (!fs.existsSync(directory)) {
    return result;
  }

  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkFilesRecursive(fullPath, result);
    } else {
      result.push(fullPath);
    }
  }

  return result;
}

export function listVideoArtifacts() {
  return walkFilesRecursive(ARTIFACTS_DIR).filter((filePath) => filePath.endsWith('.webm'));
}

export function getNewVideos(previousVideos) {
  const before = new Set(previousVideos);
  return listVideoArtifacts().filter((filePath) => !before.has(filePath));
}

export function getLatestVideo(videoPaths) {
  if (!videoPaths.length) {
    return null;
  }

  return videoPaths
    .map((filePath) => ({ filePath, mtime: fs.statSync(filePath).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0]?.filePath || null;
}

export function sanitizeName(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function hasFfmpeg() {
  const ffmpeg = spawnSync('ffmpeg', ['-version'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  const ffprobe = spawnSync('ffprobe', ['-version'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });

  return ffmpeg.status === 0 && ffprobe.status === 0;
}

export function getVideoResolution(videoPath) {
  const probe = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=s=x:p=0',
      videoPath,
    ],
    {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    }
  );

  if (probe.status !== 0 || !probe.stdout) {
    throw new Error(`Could not inspect video resolution: ${videoPath}`);
  }

  const [widthRaw, heightRaw] = probe.stdout.trim().split('x');
  const width = Number(widthRaw);
  const height = Number(heightRaw);

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`Invalid video resolution returned by ffprobe: ${probe.stdout}`);
  }

  return { width, height };
}

export function findLogoPath() {
  const candidates = [
    path.join(ROOT_DIR, 'public', 'icons', 'nostria.png'),
    path.join(ROOT_DIR, 'public', 'icons', 'icon-512x512.png'),
    path.join(ROOT_DIR, 'public', 'assets', 'nostria-social.png'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

export function createSegmentFromLogo(outputPath, width, height, durationSeconds) {
  const logoPath = findLogoPath();
  if (!logoPath) {
    throw new Error('No logo file found. Expected a logo under public/icons or public/assets.');
  }

  run('ffmpeg', [
    '-y',
    '-loop',
    '1',
    '-i',
    logoPath,
    '-f',
    'lavfi',
    '-i',
    'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-t',
    String(durationSeconds),
    '-vf',
    `scale=${Math.floor(width * 0.42)}:-1:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-shortest',
    outputPath,
  ]);
}

export function normalizeVideo(inputPath, outputPath, width, height) {
  run('ffmpeg', [
    '-y',
    '-i',
    inputPath,
    '-f',
    'lavfi',
    '-i',
    'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-vf',
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-shortest',
    outputPath,
  ]);
}

export function composeFinalVideo({
  bodyVideoPath,
  finalOutputPath,
  introPath,
  outroPath,
  feature,
  device,
}) {
  const { width, height } = getVideoResolution(bodyVideoPath);
  const tempPrefix = `${sanitizeName(feature)}-${sanitizeName(device)}-${Date.now()}`;

  const introTemp = path.join(TEMP_OUTPUT_DIR, `${tempPrefix}-intro.mp4`);
  const outroTemp = path.join(TEMP_OUTPUT_DIR, `${tempPrefix}-outro.mp4`);
  const bodyTemp = path.join(TEMP_OUTPUT_DIR, `${tempPrefix}-body.mp4`);
  const introSource = introPath && fs.existsSync(introPath) ? introPath : null;
  const outroSource = outroPath && fs.existsSync(outroPath) ? outroPath : null;

  if (introSource) {
    normalizeVideo(introSource, introTemp, width, height);
  } else {
    createSegmentFromLogo(introTemp, width, height, 2.5);
  }

  if (outroSource) {
    normalizeVideo(outroSource, outroTemp, width, height);
  } else {
    createSegmentFromLogo(outroTemp, width, height, 2.5);
  }

  normalizeVideo(bodyVideoPath, bodyTemp, width, height);

  run('ffmpeg', [
    '-y',
    '-i',
    introTemp,
    '-i',
    bodyTemp,
    '-i',
    outroTemp,
    '-filter_complex',
    '[0:v:0][0:a:0][1:v:0][1:a:0][2:v:0][2:a:0]concat=n=3:v=1:a=1[v][a]',
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '22',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    finalOutputPath,
  ]);

  return {
    introTemp,
    outroTemp,
    bodyTemp,
    outputPath: finalOutputPath,
  };
}
