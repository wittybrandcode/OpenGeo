const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const lockPath = path.join(root, 'package-lock.json');
const packagePath = path.join(root, 'package.json');
const defaultOutputPath = path.join(root, 'release', 'sbom.cdx.json');

function packageNameFromLockPath(lockEntryPath) {
  return String(lockEntryPath || '').replace(/^node_modules\//, '');
}

function purl(name, version) {
  if (name.charAt(0) === '@') {
    const parts = name.split('/');
    return `pkg:npm/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts.slice(1).join('/'))}@${encodeURIComponent(version)}`;
  }
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

function auditLockfile(lockfile, packageJson) {
  const failures = [];
  if (!lockfile || lockfile.lockfileVersion !== 3) failures.push('package-lock.json must use lockfileVersion 3.');
  const packages = lockfile && lockfile.packages && typeof lockfile.packages === 'object' ? lockfile.packages : {};
  const rootEntry = packages[''] || {};
  const runtimeDependencies = Object.keys(packageJson.dependencies || rootEntry.dependencies || {});
  if (runtimeDependencies.length) failures.push(`Runtime dependencies are not permitted in the CEP stage: ${runtimeDependencies.join(', ')}`);
  const declaredDev = Object.keys(packageJson.devDependencies || {}).sort();
  const lockedDev = Object.keys(rootEntry.devDependencies || {}).sort();
  if (declaredDev.join('|') !== lockedDev.join('|')) failures.push('package.json and package-lock.json devDependencies differ.');

  const components = [];
  for (const entryPath of Object.keys(packages).filter(Boolean).sort()) {
    const entry = packages[entryPath] || {};
    const name = packageNameFromLockPath(entryPath);
    if (!entry.version) failures.push(`${name} has no locked version.`);
    if (!entry.resolved || !/^https:\/\/registry\.npmjs\.org\//.test(entry.resolved)) failures.push(`${name} is not pinned to the HTTPS npm registry.`);
    if (!entry.integrity || !/^sha512-/.test(entry.integrity)) failures.push(`${name} has no SHA-512 lock integrity.`);
    if (entry.dev !== true) failures.push(`${name} is not marked development-only.`);
    if (!entry.license) failures.push(`${name} has no recorded license.`);
    if (entry.hasInstallScript === true) failures.push(`${name} declares an install script and requires explicit review.`);
    components.push({ entryPath, name, entry });
  }
  if (failures.length) {
    const error = new Error(`Supply-chain audit failed:\n- ${failures.join('\n- ')}`);
    error.failures = failures;
    throw error;
  }
  return { components, runtimeDependencies, declaredDev };
}

function buildSbom(lockfile, packageJson, auditResult) {
  const refs = new Map();
  for (const component of auditResult.components) refs.set(component.name, purl(component.name, component.entry.version));
  const components = auditResult.components.map(component => ({
    type: 'library',
    'bom-ref': refs.get(component.name),
    name: component.name,
    version: component.entry.version,
    scope: 'excluded',
    purl: refs.get(component.name),
    licenses: [{ license: { id: component.entry.license } }],
    properties: [
      { name: 'opengeo:dependency-scope', value: 'build-only' },
      { name: 'npm:integrity', value: component.entry.integrity },
      { name: 'npm:resolved', value: component.entry.resolved }
    ]
  }));
  const dependencies = auditResult.components.map(component => ({
    ref: refs.get(component.name),
    dependsOn: Object.keys(component.entry.dependencies || {}).map(name => refs.get(name)).filter(Boolean).sort()
  }));
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      component: {
        type: 'application',
        name: packageJson.name,
        version: packageJson.version,
        'bom-ref': `pkg:npm/${encodeURIComponent(packageJson.name)}@${encodeURIComponent(packageJson.version)}`
      },
      properties: [
        { name: 'opengeo:runtime-npm-dependencies', value: '0' },
        { name: 'opengeo:stage-includes-node-modules', value: 'false' }
      ]
    },
    components,
    dependencies
  };
}

function generateSbom(outputPath = defaultOutputPath) {
  const lockfile = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const auditResult = auditLockfile(lockfile, packageJson);
  const sbom = buildSbom(lockfile, packageJson, auditResult);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(sbom, null, 2) + '\n', 'utf8');
  return { outputPath, componentCount: sbom.components.length, runtimeDependencyCount: auditResult.runtimeDependencies.length, sbom };
}

if (require.main === module) {
  try {
    const result = generateSbom();
    console.log(`[OpenGeo] Supply-chain audit passed: ${result.componentCount} build-only components, ${result.runtimeDependencyCount} runtime npm dependencies; SBOM written to ${path.relative(root, result.outputPath)}.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { auditLockfile, buildSbom, generateSbom, purl };
