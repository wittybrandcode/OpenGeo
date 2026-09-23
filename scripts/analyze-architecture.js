const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) results = results.concat(walk(full));
    else if (file.endsWith('.js') || file.endsWith('.jsx')) results.push(full);
  });
  return results;
}

const files = [...walk('client/js'), ...walk('host')];

// 1. Analyze empty catch blocks
let emptyCatches = [];
let totalEmptyCatches = 0;
// 2. Analyze 'this.app.' occurrences
let appCoupling = {};
// 3. Analyze duplicate functions like latLonToWorld
let latLonDuplicates = [];
// 4. Analyze event bus usage
let eventBusEvents = new Set();
// 5. High-complexity files (> 20 methods)
let highComplexity = [];

files.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  const rel = f.replace(/\\/g, '/');
  
  // Empty catch regex
  const catchRegex = /catch\s*\([^)]*\)\s*\{\s*\}/g;
  let match;
  let count = 0;
  while ((match = catchRegex.exec(content)) !== null) {
    count++;
  }
  if (count > 0) {
    emptyCatches.push({ file: rel, count });
    totalEmptyCatches += count;
  }

  // this.app coupling
  const appMatches = content.match(/this\.app\.[a-zA-Z0-9_]+/g);
  if (appMatches) {
    appCoupling[rel] = appMatches.length;
  }

  // latLonToWorld or similar projections
  if (content.includes('latLonToWorld') || content.includes('latLngToWorld')) {
    latLonDuplicates.push(rel);
  }

  // event strings
  const busRegex = /globalEventBus\.(emit|on)\((['"])([^'"]+)\2/g;
  let busMatch;
  while ((busMatch = busRegex.exec(content)) !== null) {
    eventBusEvents.add(busMatch[3]);
  }

  // Count class methods
  const methodRegex = /^\s*(async\s+)?[a-zA-Z0-9_]+\s*\([^)]*\)\s*\{/gm;
  const methods = content.match(methodRegex);
  if (methods && methods.length >= 15) {
    highComplexity.push({ file: rel, methodCount: methods.length });
  }
});

console.log('====================================================');
console.log('1. SILENT ERROR SWALLOWING (empty catch blocks):');
console.log('Total empty catch blocks found:', totalEmptyCatches);
console.log('Top files with empty catches:');
console.table(emptyCatches.sort((a,b) => b.count - a.count).slice(0, 10));

console.log('====================================================');
console.log('2. GOD OBJECT COUPLING (this.app.xxx occurrences):');
console.table(Object.entries(appCoupling).map(([file, count]) => ({ file, count })).sort((a,b) => b.count - a.count).slice(0, 12));

console.log('====================================================');
console.log('3. DUPLICATED PROJECTION LOGIC (latLonToWorld / latLngToWorld):');
console.log('Found in', latLonDuplicates.length, 'files:');
latLonDuplicates.forEach(f => console.log(' - ' + f));

console.log('====================================================');
console.log('4. HIGH-COMPLEXITY CLASSES (methods >= 15):');
console.table(highComplexity.sort((a,b) => b.methodCount - a.methodCount).slice(0, 10));

console.log('====================================================');
console.log('5. RAW UNTYPED EVENT BUS STRINGS (' + eventBusEvents.size + ' unique strings):');
console.log(Array.from(eventBusEvents).sort().join(', '));
