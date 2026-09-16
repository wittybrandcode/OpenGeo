'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Reads a CSS file and recursively expands all @import statements
 * to provide the full aggregated stylesheet content for testing.
 *
 * @param {string} filePath Absolute or relative path to the CSS entry file
 * @returns {string} Fully aggregated CSS text
 */
function readAggregatedCss(filePath) {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`CSS file not found: ${resolvedPath}`);
  }

  const content = fs.readFileSync(resolvedPath, 'utf8');
  const dir = path.dirname(resolvedPath);

  return content.replace(/@import\s+(?:url\(['"]?|['"])([^'")]+)['"]?\)?;?/g, (match, relPath) => {
    const importedPath = path.resolve(dir, relPath);
    if (fs.existsSync(importedPath)) {
      return `\n/* @import ${relPath} */\n` + readAggregatedCss(importedPath) + '\n';
    }
    return match;
  });
}

module.exports = { readAggregatedCss };
