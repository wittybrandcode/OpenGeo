/**
 * OpenGeo ZXP Packaging Script
 *
 * Usage:
 *   node scripts/zxp.js [--sign]
 *
 * Prerequisites:
 *   - ZXPSignCmd installed (https://github.com/Adobe-Photoshop/SignCmd)
 *   - Certificate file (.p12) for signing
 *     (or use --selfSigned to generate a self-signed cert)
 *
 * The build folder is already structured as a CEP extension.
 * This script compresses it into a .zxp file for distribution.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const BUILD = path.join(ROOT, 'build');
const PACKAGE_NAME = 'OpenGeo.zxp';
const PACKAGE_DEST = path.join(ROOT, PACKAGE_NAME);

const ZXPSignCmd = process.env.ZXPSignCmd || 'ZXPSignCmd';

function log(msg) {
  console.log('[ZXP] ' + msg);
}

function findZXPSignCmd() {
  try {
    execSync(`"${ZXPSignCmd}" -help`, { stdio: 'ignore' });
    return true;
  } catch (e) {
    try {
      execSync('ZXPSignCmd -help', { stdio: 'ignore' });
      return true;
    } catch (e2) {
      return false;
    }
  }
}

function buildZXP(sign, certPath, certPass) {
  log('Packaging ZXP from: ' + DIST);

  if (!fs.existsSync(DIST)) {
    log('ERROR: dist/ not found. Run "node scripts/build.js" first.');
    process.exit(1);
  }

  if (fs.existsSync(PACKAGE_DEST)) {
    fs.unlinkSync(PACKAGE_DEST);
    log('Removed existing ' + PACKAGE_NAME);
  }

  try {
    const args = [
      `-selfSigned`,
      `"${PACKAGE_DEST}"`,
      `"${DIST}"`,
      PACKAGE_NAME
    ];

    if (sign && certPath && certPass) {
      const cmd = `"${ZXPSignCmd}" -sign "${DIST}" "${PACKAGE_DEST}" "${certPath}" "${certPass}" -expiresDays 3650`;
      log('Running: ' + cmd);
      execSync(cmd, { stdio: 'inherit' });
    } else {
      const cmd = `"${ZXPSignCmd}" -selfSigned "${PACKAGE_DEST}" "${DIST}" "${PACKAGE_NAME}"`;
      log('Running (self-signed): ' + cmd);
      execSync(cmd, { stdio: 'inherit' });
    }

    log('ZXP package created: ' + PACKAGE_DEST);
    log('Size: ' + (fs.statSync(PACKAGE_DEST).size / 1024).toFixed(1) + ' KB');
  } catch (e) {
    log('ERROR: Failed to create ZXP package.');
    log('Make sure ZXPSignCmd is installed and in PATH.');
    log('');
    log('  Download: https://github.com/Adobe-Photoshop/SignCmd/releases');
    log('');
    log('Or use the dist/ directory directly as an unpacked extension.');
    process.exit(1);
  }
}

// CLI
const args = process.argv.slice(2);
const shouldSign = args.includes('--sign');
const certIndex = args.indexOf('--cert');
const certPath = certIndex >= 0 ? args[certIndex + 1] : null;
const passIndex = args.indexOf('--pass');
const certPass = passIndex >= 0 ? args[passIndex + 1] : null;

if (!findZXPSignCmd()) {
  log('ZXPSignCmd not found. Install it or use dist/ as unpacked extension.');
  log('');
  log('To install as unpacked extension:');
  log('  Copy dist/ to:');
  log('    C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions\\OpenGeo');
  log('  OR');
  log('    %APPDATA%\\Adobe\\CEP\\extensions\\OpenGeo');
  process.exit(0);
}

buildZXP(shouldSign, certPath, certPass);
