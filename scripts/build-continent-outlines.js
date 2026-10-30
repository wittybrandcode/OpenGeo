/**
 * OpenGeo Continents Outlines Generator
 *
 * Generates unified continent vector outline files (without internal country borders)
 * and a master continents index.
 *
 * Continents:
 *  - AFR: Africa / أفريقيا
 *  - ASI: Asia / آسيا
 *  - EUR: Europe / أوروبا
 *  - NAM: North America / أمريكا الشمالية
 *  - SAM: South America / أمريكا الجنوبية
 *  - OCE: Oceania / أوقيانوسيا
 *  - ATA: Antarctica / القارة القطبية الجنوبية
 *  - WLD: All Continents (World Landmass) / كل القارات
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const turfUnion = require('@turf/union').default || require('@turf/union');
const { feature, featureCollection } = require('@turf/helpers');

const root = path.resolve(__dirname, '..');
const source50m = path.join(root, 'scripts', 'vector-data-sources', 'natural-earth', '50m', 'ne_50m_admin_0_countries.geojson');

const requestedDataDir = process.argv.find(arg => arg.startsWith('--data-dir='));
const dataDir = requestedDataDir
  ? path.resolve(requestedDataDir.slice('--data-dir='.length))
  : path.join(root, 'client', 'assets', 'data');

const outputVectorsDir = path.join(dataDir, 'vectors');
const outputContinentsDir = path.join(outputVectorsDir, 'continents');
const outputIndexPath = path.join(outputVectorsDir, 'continents-index-10m.json');

const MAP_SIZE = 262144;
const MAX_POINT_COUNT = 85000;
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MiB

const CONTINENT_DEFINITIONS = [
  {
    code: 'AFR',
    continentName: 'Africa',
    name: 'Africa',
    nameAr: 'أفريقيا',
    centerLat: 2.5,
    centerLng: 21.0,
    aliases: ['افريقيا', 'أفريقيا', 'القارة السمراء', 'Africa', 'قارة افريقيا', 'قارة أفريقيا']
  },
  {
    code: 'ASI',
    continentName: 'Asia',
    name: 'Asia',
    nameAr: 'آسيا',
    centerLat: 34.0,
    centerLng: 88.0,
    aliases: ['اسيا', 'آسيا', 'Asia', 'قارة اسيا', 'قارة آسيا']
  },
  {
    code: 'EUR',
    continentName: 'Europe',
    name: 'Europe',
    nameAr: 'أوروبا',
    centerLat: 53.0,
    centerLng: 20.0,
    aliases: ['اوروبا', 'أوروبا', 'Europe', 'قارة اوروبا', 'قارة أوروبا']
  },
  {
    code: 'NAM',
    continentName: 'North America',
    name: 'North America',
    nameAr: 'أمريكا الشمالية',
    centerLat: 46.0,
    centerLng: -98.0,
    aliases: ['امريكا الشمالية', 'امريكا الشماليه', 'أمريكا الشمالية', 'North America', 'قارة امريكا الشمالية']
  },
  {
    code: 'SAM',
    continentName: 'South America',
    name: 'South America',
    nameAr: 'أمريكا الجنوبية',
    centerLat: -18.0,
    centerLng: -58.0,
    aliases: ['امريكا الجنوبية', 'امريكا الجنوبيه', 'أمريكا الجنوبية', 'South America', 'قارة امريكا الجنوبية']
  },
  {
    code: 'OCE',
    continentName: 'Oceania',
    name: 'Oceania',
    nameAr: 'أوقيانوسيا',
    centerLat: -24.0,
    centerLng: 135.0,
    aliases: ['اوقيانوسيا', 'أوقيانوسيا', 'استراليا', 'أستراليا', 'Oceania', 'Australia']
  },
  {
    code: 'ATA',
    continentName: 'Antarctica',
    name: 'Antarctica',
    nameAr: 'القارة القطبية الجنوبية',
    centerLat: -82.0,
    centerLng: 0.0,
    aliases: ['انتاركتيكا', 'أنتاركتيكا', 'القارة القطبية الجنوبية', 'Antarctica']
  }
];

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function projectPoint(point) {
  if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
  const lng = point[0];
  const lat = Math.max(-85.05112878, Math.min(85.05112878, point[1]));
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const x = Math.max(0, Math.min(MAP_SIZE, ((lng + 180) / 360) * MAP_SIZE));
  const y = Math.max(0, Math.min(MAP_SIZE, ((1 - Math.log((1 + sinLat) / (1 - sinLat)) / (2 * Math.PI)) / 2) * MAP_SIZE));
  return [
    Math.round(x * 100) / 100,
    Math.round(y * 100) / 100
  ];
}

function projectLine(line) {
  if (!Array.isArray(line)) return null;
  const points = [];
  for (let i = 0; i < line.length; i++) {
    const pt = projectPoint(line[i]);
    if (pt) points.push(pt);
  }
  return points.length >= 2 ? points : null;
}

function projectPolygonRings(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.map(polygon => {
    const projected = projectLine(polygon && polygon[0]);
    if (!projected) return null;
    const first = projected[0];
    const last = projected[projected.length - 1];
    if (first && last && first[0] === last[0] && first[1] === last[1]) projected.pop();
    return projected.length >= 3 ? projected : null;
  }).filter(Boolean);
}

function buildContinentOutlines(targetDataDir = dataDir) {
  const targetVectorsDir = path.join(targetDataDir, 'vectors');
  const targetContinentsDir = path.join(targetVectorsDir, 'continents');
  const targetIndexPath = path.join(targetVectorsDir, 'continents-index-10m.json');

  if (!fs.existsSync(source50m)) {
    throw new Error(`Missing source 50m countries: ${source50m}`);
  }

  const rawData = JSON.parse(fs.readFileSync(source50m, 'utf8'));
  const allFeatures = rawData.features || [];

  fs.mkdirSync(targetContinentsDir, { recursive: true });

  const indexEntries = {};
  let grandTotalPoints = 0;
  let grandTotalBytes = 0;
  const allContinentRingsCombined = [];

  for (const def of CONTINENT_DEFINITIONS) {
    const contFeatures = allFeatures.filter(f => f.properties && f.properties.CONTINENT === def.continentName);
    if (!contFeatures.length) {
      console.warn(`[Continents] Warning: No features for continent ${def.name}`);
      continue;
    }

    let mergedGeom = null;
    if (contFeatures.length === 1) {
      mergedGeom = contFeatures[0].geometry;
    } else {
      const fc = featureCollection(contFeatures.map(f => feature(f.geometry)));
      const merged = turfUnion(fc);
      mergedGeom = merged && merged.geometry;
    }

    if (!mergedGeom) {
      throw new Error(`Failed to union geometries for continent ${def.name}`);
    }

    const rings = projectPolygonRings(mergedGeom);
    let pointCount = 0;
    for (const r of rings) {
      pointCount += r.length;
      allContinentRingsCombined.push(r);
    }

    if (pointCount > MAX_POINT_COUNT) {
      throw new Error(`Point count budget exceeded for continent ${def.code}: ${pointCount} > ${MAX_POINT_COUNT}`);
    }

    const labelPoint = projectPoint([def.centerLng, def.centerLat]);

    const continentPayload = {
      schemaVersion: '1.0.0',
      dataTier: 'continent50m',
      code: def.code,
      name: def.name,
      nameAr: def.nameAr,
      label: labelPoint,
      pointCount: pointCount,
      ringCount: rings.length,
      provenance: {
        sourceDataset: 'Natural Earth 1:50m Admin-0 Countries (Unified Landmass)',
        cartographyPolicyVersion: '1.0.0'
      },
      features: [
        {
          id: `continent-outline-${def.code}`,
          type: 'ContinentLandOutline',
          code: def.code,
          name: def.name,
          nameAr: def.nameAr,
          isClosed: true,
          rings: rings
        }
      ]
    };

    const jsonString = JSON.stringify(continentPayload);
    const jsonBuffer = Buffer.from(jsonString, 'utf8');

    if (jsonBuffer.length > MAX_FILE_BYTES) {
      throw new Error(`File size budget exceeded for continent ${def.code}: ${jsonBuffer.length} > ${MAX_FILE_BYTES}`);
    }

    const continentFilePath = path.join(targetContinentsDir, `${def.code}.json`);
    fs.writeFileSync(continentFilePath, jsonBuffer);

    const relativeFile = `continents/${def.code}.json`;
    const fileSha256 = sha256Buffer(jsonBuffer);

    indexEntries[def.code] = {
      code: def.code,
      name: def.name,
      nameAr: def.nameAr,
      relativeFile: relativeFile,
      bytes: jsonBuffer.length,
      sha256: fileSha256,
      pointCount: pointCount,
      ringCount: rings.length,
      label: labelPoint,
      aliases: def.aliases
    };

    grandTotalPoints += pointCount;
    grandTotalBytes += jsonBuffer.length;
    console.log(`[Continents] Built ${def.name} (${def.code}): ${pointCount} points across ${rings.length} rings (${jsonBuffer.length} bytes).`);
  }

  // Build the composite World Landmass (WLD)
  const worldCode = 'WLD';
  const worldName = 'World Continents';
  const worldNameAr = 'كل القارات';
  const worldLabel = projectPoint([15.0, 25.0]);
  let worldPointCount = 0;
  for (const r of allContinentRingsCombined) {
    worldPointCount += r.length;
  }

  const worldPayload = {
    schemaVersion: '1.0.0',
    dataTier: 'continent50m',
    code: worldCode,
    name: worldName,
    nameAr: worldNameAr,
    label: worldLabel,
    pointCount: worldPointCount,
    ringCount: allContinentRingsCombined.length,
    provenance: {
      sourceDataset: 'Natural Earth 1:50m Admin-0 Countries (All Continents Unified)',
      cartographyPolicyVersion: '1.0.0'
    },
    features: [
      {
        id: `continent-outline-${worldCode}`,
        type: 'ContinentLandOutline',
        code: worldCode,
        name: worldName,
        nameAr: worldNameAr,
        isClosed: true,
        rings: allContinentRingsCombined
      }
    ]
  };

  const worldJsonString = JSON.stringify(worldPayload);
  const worldJsonBuffer = Buffer.from(worldJsonString, 'utf8');
  const worldFilePath = path.join(targetContinentsDir, `${worldCode}.json`);
  fs.writeFileSync(worldFilePath, worldJsonBuffer);

  const worldRelativeFile = `continents/${worldCode}.json`;
  const worldSha256 = sha256Buffer(worldJsonBuffer);

  indexEntries[worldCode] = {
    code: worldCode,
    name: worldName,
    nameAr: worldNameAr,
    relativeFile: worldRelativeFile,
    bytes: worldJsonBuffer.length,
    sha256: worldSha256,
    pointCount: worldPointCount,
    ringCount: allContinentRingsCombined.length,
    label: worldLabel,
    aliases: ['خريطة العالم بدون حدود', 'كل القارات', 'العالم', 'قارات العالم', 'All Continents', 'World Landmass', 'World', 'Continents']
  };

  grandTotalPoints += worldPointCount;
  grandTotalBytes += worldJsonBuffer.length;

  const sortedKeys = Object.keys(indexEntries).sort();
  const sortedContinentsMap = {};
  for (const k of sortedKeys) {
    sortedContinentsMap[k] = indexEntries[k];
  }

  const indexPayload = {
    schemaVersion: '1.0.0',
    dataTier: 'continent50m',
    continentCount: sortedKeys.length,
    totalPoints: grandTotalPoints,
    totalBytes: grandTotalBytes,
    continents: sortedContinentsMap
  };

  const indexString = JSON.stringify(indexPayload, null, 2) + '\n';
  fs.writeFileSync(targetIndexPath, Buffer.from(indexString, 'utf8'));

  const summary = `[OpenGeo] Continents outlines successfully built: ${sortedKeys.length} items, ${grandTotalPoints} total points, ${grandTotalBytes} total bytes.`;
  console.log(summary);
  return {
    ok: true,
    continentCount: sortedKeys.length,
    totalPoints: grandTotalPoints,
    totalBytes: grandTotalBytes,
    summary: summary
  };
}

if (require.main === module) {
  try {
    buildContinentOutlines();
  } catch (err) {
    console.error(`[Continents ERROR] ${err.message}`);
    process.exit(1);
  }
}

module.exports = { buildContinentOutlines };
