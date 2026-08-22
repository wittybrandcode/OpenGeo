const fs = require('fs');
const path = require('path');
const contracts = require('../client/js/events/EventContracts.js');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : (entry.name.endsWith('.js') ? [target] : []);
  });
}

function audit(root = path.resolve(__dirname, '../client/js')) {
  const usages = [];
  const patterns = [
    /globalEventBus\.(?:emit|on|once)\(\s*['"]([^'"]+)['"]/g,
    /this\._subscribe\(\s*['"]([^'"]+)['"]/g
  ];
  for (const file of walk(root)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(source)) !== null) usages.push({ event: match[1], file: path.relative(root, file) });
    }
  }
  const unknown = usages.filter(usage => !contracts.isKnown(usage.event));
  return { ok: unknown.length === 0, usages, unknown, catalogSize: Object.keys(contracts.catalog).length };
}

if (require.main === module) {
  const result = audit();
  if (!result.ok) {
    for (const usage of result.unknown) console.error(`[OpenGeo.EventAudit] Unknown event ${usage.event} in ${usage.file}`);
    process.exit(1);
  }
  console.log(`[OpenGeo.EventAudit] ${result.usages.length} literal usages covered by ${result.catalogSize} catalog entries.`);
}

module.exports = { audit };
