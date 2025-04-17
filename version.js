const fs = require('fs');
const path = require('path');

// Paths to the files that need version updates
const packageJsonPath = path.join(__dirname, 'package.json');
const cargoTomlPath = path.join(__dirname, 'src-tauri', 'Cargo.toml');
const tauriConfPath = path.join(__dirname, 'src-tauri', 'tauri.conf.json');

async function updateVersion() {
    try {
        // Read package.json to get current version
        const packageJsonContent = await fs.promises.readFile(packageJsonPath, 'utf8');
        const packageJson = JSON.parse(packageJsonContent);
        const currentVersion = packageJson.version;
        
        // Split version into major, minor, and patch components
        const versionParts = currentVersion.split('.');
        if (versionParts.length !== 3) {
            throw new Error(`Invalid version format: ${currentVersion}`);
        }
        
        const [major, minor, patch] = versionParts.map(Number);
        // Increment the patch/revision number
        const newVersion = `${major}.${minor}.${patch + 1}`;
        console.log(`Bumping version: ${currentVersion} → ${newVersion}`);
        
        // Update package.json
        packageJson.version = newVersion;
        await fs.promises.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
        console.log(`✓ Updated package.json`);
        
        // Update Cargo.toml
        let cargoContent = await fs.promises.readFile(cargoTomlPath, 'utf8');
        cargoContent = cargoContent.replace(/^version\s*=\s*"[^"]*"/m, `version = "${newVersion}"`);
        await fs.promises.writeFile(cargoTomlPath, cargoContent);
        console.log(`✓ Updated src-tauri/Cargo.toml`);
        
        // Update tauri.conf.json
        const tauriConfContent = await fs.promises.readFile(tauriConfPath, 'utf8');
        const tauriConf = JSON.parse(tauriConfContent);
        if (tauriConf.version) {
            tauriConf.version = newVersion;
            await fs.promises.writeFile(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
            console.log(`✓ Updated src-tauri/tauri.conf.json`);
        } else {
            console.warn('⚠️ Could not find version field in tauri.conf.json');
        }
        
        console.log(`Version bumped successfully to ${newVersion}`);
    } catch (error) {
        console.error('Error updating version:', error);
        process.exit(1);
    }
}

updateVersion();
