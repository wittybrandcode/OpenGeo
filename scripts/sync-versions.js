const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const packageJsonPath = path.join(ROOT, 'package.json');
const manifestXmlPath = path.join(ROOT, 'CSXS', 'manifest.xml');

console.log('====================================');
console.log('[OpenGeo] Syncing Versions...');
console.log('====================================');

try {
  // Read package.json version
  const pkgData = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const version = pkgData.version;
  console.log(`📦 package.json version: ${version}`);

  // Read manifest.xml
  if (fs.existsSync(manifestXmlPath)) {
    let manifest = fs.readFileSync(manifestXmlPath, 'utf8');
    
    // Update ExtensionBundleVersion
    manifest = manifest.replace(/ExtensionBundleVersion="[^"]+"/, `ExtensionBundleVersion="${version}"`);
    
    // Update the extension inside DispatchInfoList/Extension
    manifest = manifest.replace(/(<Extension Id="com\.opengeo\.map\.panel"\s+Version=")[^"]+(")/, `$1${version}$2`);

    fs.writeFileSync(manifestXmlPath, manifest, 'utf8');
    console.log(`✅ CSXS/manifest.xml synced to version: ${version}`);
  } else {
    console.error(`❌ manifest.xml not found at ${manifestXmlPath}`);
    process.exit(1);
  }

  // Update CSXS/extension.properties
  const extPropPath = path.join(ROOT, 'CSXS', 'extension.properties');
  if (fs.existsSync(extPropPath)) {
    fs.writeFileSync(extPropPath, `version=${version}\n`, 'utf8');
    console.log(`✅ CSXS/extension.properties synced to version: ${version}`);
  }

  // Update client/js/config.js
  const configJsPath = path.join(ROOT, 'client', 'js', 'config.js');
  if (fs.existsSync(configJsPath)) {
    let configContent = fs.readFileSync(configJsPath, 'utf8');
    configContent = configContent.replace(/(version:\s*')[^']+(\')/, `$1${version}$2`);
    fs.writeFileSync(configJsPath, configContent, 'utf8');
    console.log(`✅ client/js/config.js synced to version: ${version}`);
  }

  // Update client/js/core/VersionMigrations.js
  const migrationsPath = path.join(ROOT, 'client', 'js', 'core', 'VersionMigrations.js');
  if (fs.existsSync(migrationsPath)) {
    let migrationsContent = fs.readFileSync(migrationsPath, 'utf8');
    migrationsContent = migrationsContent.replace(/(app:\s*')[^']+(\')/, `$1${version}$2`);
    fs.writeFileSync(migrationsPath, migrationsContent, 'utf8');
    console.log(`✅ client/js/core/VersionMigrations.js synced to version: ${version}`);
  }

  console.log('✅ Version synchronization complete.');
} catch (e) {
  console.error('❌ Failed to sync versions', e);
  process.exit(1);
}
