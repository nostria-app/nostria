import path from 'node:path';
import { FEATURE_TAGS, run } from './video-utils.mjs';
import { parseScenesMarkdown } from './scene-markdown-parser.mjs';

const ROOT_DIR = process.cwd();

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

function hasFlag(name) {
  return process.argv.includes(name);
}

function resolveOptionalPath(value) {
  if (!value) {
    return null;
  }

  return path.resolve(ROOT_DIR, value);
}

function validateScenes(scenes) {
  for (const scene of scenes) {
    if (scene.mode === 'feature') {
      const isKnownFeature = Object.prototype.hasOwnProperty.call(FEATURE_TAGS, scene.feature);
      const isSpecialFeature = scene.feature === 'all' || scene.feature === 'auth';
      if (!isKnownFeature && !isSpecialFeature) {
        throw new Error(
          `Scene '${scene.scene}' uses unknown feature '${scene.feature}'. Valid: ${Object.keys(FEATURE_TAGS).join(', ')}, all, auth.`
        );
      }
    }
  }
}

function buildFeatureArgs(scene) {
  const args = ['scripts/demo/run-demo-videos.mjs', '--feature', scene.feature, '--device', scene.device];

  args.push('--compose', scene.compose ? 'true' : 'false');

  const introPath = resolveOptionalPath(scene.intro);
  if (introPath) {
    args.push('--intro', introPath);
  }

  const outroPath = resolveOptionalPath(scene.outro);
  if (outroPath) {
    args.push('--outro', outroPath);
  }

  return args;
}

function buildShowcaseArgs(scene) {
  const args = ['scripts/demo/build-showcase-video.mjs', '--device', scene.device, '--rerun', scene.rerun ? 'true' : 'false'];

  const introPath = resolveOptionalPath(scene.intro);
  if (introPath) {
    args.push('--intro', introPath);
  }

  const outroPath = resolveOptionalPath(scene.outro);
  if (outroPath) {
    args.push('--outro', outroPath);
  }

  return args;
}

function expandShowcaseScene(scene) {
  if (scene.device !== 'both') {
    return [scene];
  }

  return [
    { ...scene, device: 'desktop' },
    { ...scene, device: 'mobile' },
  ];
}

function printScenePlan(scenes, filePath) {
  console.log(`🧾 Scenes file: ${filePath}`);
  for (const scene of scenes) {
    console.log(`- ${scene.scene} | mode=${scene.mode} | feature=${scene.feature || '-'} | device=${scene.device}`);
  }
}

async function main() {
  const fileArg = getArg('--file', 'docs/demo-scenes.md');
  const sceneFilter = getArg('--scene', '');
  const dryRun = hasFlag('--dry-run');
  const filePath = path.resolve(ROOT_DIR, fileArg);

  const parsedScenes = parseScenesMarkdown(filePath);
  const scenes = sceneFilter
    ? parsedScenes.filter((scene) => scene.scene.toLowerCase() === sceneFilter.toLowerCase())
    : parsedScenes;

  if (!scenes.length) {
    throw new Error(sceneFilter
      ? `No enabled scene named '${sceneFilter}' found in ${filePath}.`
      : `No enabled scenes found in ${filePath}.`);
  }

  validateScenes(scenes);
  printScenePlan(scenes, filePath);

  if (dryRun) {
    console.log('✅ Dry run complete.');
    return;
  }

  for (const scene of scenes) {
    const expanded = scene.mode === 'showcase' ? expandShowcaseScene(scene) : [scene];

    for (const runScene of expanded) {
      console.log(`\n🎬 Scene: ${runScene.scene} (${runScene.mode}, ${runScene.device})`);
      const args = runScene.mode === 'showcase'
        ? buildShowcaseArgs(runScene)
        : buildFeatureArgs(runScene);

      run('node', args);
    }
  }
}

main().catch((error) => {
  console.error(`❌ Scene pipeline failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
