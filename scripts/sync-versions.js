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

  console.log('✅ Version synchronization complete.');
} catch (e) {
  console.error('❌ Failed to sync versions', e);
  process.exit(1);
}
