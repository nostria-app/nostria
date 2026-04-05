const fs = require('node:fs/promises');
const path = require('node:path');

const rootDir = __dirname;
const files = {
  packageJson: path.join(rootDir, 'package.json'),
  packageLock: path.join(rootDir, 'package-lock.json'),
  manifest: path.join(rootDir, 'public', 'manifest.webmanifest'),
  cargoToml: path.join(rootDir, 'src-tauri', 'Cargo.toml'),
  appleProject: path.join(rootDir, 'src-tauri', 'gen', 'apple', 'project.yml'),
  appleInfoPlist: path.join(rootDir, 'src-tauri', 'gen', 'apple', 'nostria_iOS', 'Info.plist'),
};

function bumpPatchVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Unsupported version format in package.json: ${version}`);
  }

  const [, major, minor, patch] = match;
  return `${major}.${minor}.${Number.parseInt(patch, 10) + 1}`;
}

function getLineEnding(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

async function readText(filePath) {
  return fs.readFile(filePath, 'utf8');
}

async function writeText(filePath, text) {
  await fs.writeFile(filePath, text, 'utf8');
}

async function updateJsonFile(filePath, updater) {
  const original = await readText(filePath);
  const newline = getLineEnding(original);
  const parsed = JSON.parse(original);

  updater(parsed);

  await writeText(filePath, `${JSON.stringify(parsed, null, 2)}${newline}`);
}

function replaceOrThrow(content, matcher, replacer, fileLabel) {
  const updated = content.replace(matcher, replacer);
  if (updated === content) {
    throw new Error(`Could not update version in ${fileLabel}`);
  }

  return updated;
}

async function updateTextFile(filePath, updater) {
  const original = await readText(filePath);
  const updated = updater(original);
  await writeText(filePath, updated);
}

async function main() {
  const packageJsonContent = await readText(files.packageJson);
  const packageJson = JSON.parse(packageJsonContent);
  const currentVersion = packageJson.version;
  const nextVersion = bumpPatchVersion(currentVersion);

  console.log(`Bumping version ${currentVersion} -> ${nextVersion}`);

  await updateJsonFile(files.packageJson, (json) => {
    json.version = nextVersion;
  });
  console.log('Updated package.json');

  await updateJsonFile(files.manifest, (json) => {
    json.version = nextVersion;
  });
  console.log('Updated public/manifest.webmanifest');

  await updateTextFile(files.cargoToml, (content) =>
    replaceOrThrow(
      content,
      /(\[package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/,
      `$1${nextVersion}$3`,
      'src-tauri/Cargo.toml'
    )
  );
  console.log('Updated src-tauri/Cargo.toml');

  await updateTextFile(files.appleProject, (content) => {
    let updated = replaceOrThrow(
      content,
      /(CFBundleShortVersionString:\s*)([^\r\n]+)/,
      `$1${nextVersion}`,
      'src-tauri/gen/apple/project.yml (CFBundleShortVersionString)'
    );

    updated = replaceOrThrow(
      updated,
      /(CFBundleVersion:\s*")([^"]+)(")/,
      `$1${nextVersion}$3`,
      'src-tauri/gen/apple/project.yml (CFBundleVersion)'
    );

    return updated;
  });
  console.log('Updated src-tauri/gen/apple/project.yml');

  await updateTextFile(files.appleInfoPlist, (content) => {
    let updated = replaceOrThrow(
      content,
      /(<key>CFBundleShortVersionString<\/key>\s*<string>)([^<]+)(<\/string>)/,
      `$1${nextVersion}$3`,
      'src-tauri/gen/apple/nostria_iOS/Info.plist (CFBundleShortVersionString)'
    );

    updated = replaceOrThrow(
      updated,
      /(<key>CFBundleVersion<\/key>\s*<string>)([^<]+)(<\/string>)/,
      `$1${nextVersion}$3`,
      'src-tauri/gen/apple/nostria_iOS/Info.plist (CFBundleVersion)'
    );

    return updated;
  });
  console.log('Updated src-tauri/gen/apple/nostria_iOS/Info.plist');

  try {
    await updateJsonFile(files.packageLock, (json) => {
      json.version = nextVersion;

      if (json.packages?.['']) {
        json.packages[''].version = nextVersion;
      }
    });
    console.log('Updated package-lock.json');
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('Skipped package-lock.json (not found)');
    } else {
      throw error;
    }
  }

  console.log(`Version bump complete: ${currentVersion} -> ${nextVersion}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
