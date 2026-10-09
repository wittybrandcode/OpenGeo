/**
 * OpenGeo Studio 10m Country Outlines Generator
 *
 * Generates per-country high-detail vector outline files and a master index.
 * Part of the Vector Map Quality Upgrade Plan (Studio 10m).
 *
 * Constraints:
 *  - Deterministic, bit-for-bit reproducible output.
 *  - Strict point limit <= 85,000 points per country.
 *  - Strict file size limit <= 2 MiB per country.
 *  - Exterior land perimeter only (no EEZ, no internal lake holes).
 *  - Policy compliance: locked profiles for MAR/ESH from CARTOGRAPHY_POLICY.json.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bboxClip = require('@turf/bbox-clip').default || require('@turf/bbox-clip');
const turfUnion = require('@turf/union').default || require('@turf/union');
const { feature, featureCollection } = require('@turf/helpers');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'scripts', 'vector-data-sources', 'natural-earth', '10m');
const profileSourceDir = path.join(root, 'scripts', 'vector-data-sources', 'opengeo-profiles');
const policySourcePath = path.join(root, 'scripts', 'vector-data-sources', 'CARTOGRAPHY_POLICY.json');

const requestedDataDir = process.argv.find(arg => arg.startsWith('--data-dir='));
const dataDir = requestedDataDir
  ? path.resolve(requestedDataDir.slice('--data-dir='.length))
  : path.join(root, 'client', 'assets', 'data');

const outputVectorsDir = path.join(dataDir, 'vectors');
const outputCountriesDir = path.join(outputVectorsDir, 'country-outlines-studio10m');
const outputIndexPath = path.join(outputVectorsDir, 'country-outlines-studio10m-index.json');

const MAP_SIZE = 262144;
const MAX_POINT_COUNT = 85000;
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MiB

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function geometrySha256(featureObj) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ iso3: featureObj.iso3, rings: featureObj.rings }))
    .digest('hex');
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

function projectCountryOuterRings(geometry) {
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

function projectPointExact(point) {
  if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
  const lng = point[0];
  const lat = Math.max(-85.05112878, Math.min(85.05112878, point[1]));
  const sinLat = Math.sin((lat * Math.PI) / 180);
  return [
    ((lng + 180) / 360) * MAP_SIZE,
    ((1 - Math.log((1 + sinLat) / (1 - sinLat)) / (2 * Math.PI)) / 2) * MAP_SIZE
  ];
}

function projectLineExact(line) {
  if (!Array.isArray(line)) return null;
  const points = [];
  for (let i = 0; i < line.length; i++) {
    const pt = projectPointExact(line[i]);
    if (pt) points.push(pt);
  }
  return points.length >= 2 ? points : null;
}

function projectCountryOuterRingsExact(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.map(polygon => {
    const projected = projectLineExact(polygon && polygon[0]);
    if (!projected) return null;
    const first = projected[0];
    const last = projected[projected.length - 1];
    if (first && last && first[0] === last[0] && first[1] === last[1]) projected.pop();
    return projected.length >= 3 ? projected : null;
  }).filter(Boolean);
}

function decodeTopologyArc(topology, arcIndex) {
  const sourceIndex = arcIndex < 0 ? ~arcIndex : arcIndex;
  const arc = topology.arcs && topology.arcs[sourceIndex];
  if (!Array.isArray(arc) || !topology.transform) return [];
  const scale = topology.transform.scale || [];
  const translate = topology.transform.translate || [];
  if (!Number.isFinite(scale[0]) || !Number.isFinite(scale[1]) || !Number.isFinite(translate[0]) || !Number.isFinite(translate[1])) return [];
  let x = 0;
  let y = 0;
  const points = [];
  for (let pointIndex = 0; pointIndex < arc.length; pointIndex++) {
    const delta = arc[pointIndex];
    if (!Array.isArray(delta) || delta.length < 2) continue;
    x += delta[0];
    y += delta[1];
    points.push([translate[0] + (x * scale[0]), translate[1] + (y * scale[1])]);
  }
  return arcIndex < 0 ? points.reverse() : points;
}

function joinTopologyArcs(topology, arcIndexes) {
  const ring = [];
  for (let arcIndex = 0; arcIndex < arcIndexes.length; arcIndex++) {
    const points = decodeTopologyArc(topology, arcIndexes[arcIndex]);
    for (let pointIndex = arcIndex === 0 ? 0 : 1; pointIndex < points.length; pointIndex++) ring.push(points[pointIndex]);
  }
  return ring;
}

function topologyGeometryToGeoJson(topology, geometry) {
  if (!geometry || !Array.isArray(geometry.arcs)) return null;
  const decodeRing = arcIndexes => {
    const ring = joinTopologyArcs(topology, arcIndexes);
    if (ring.length > 2 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push(ring[0]);
    return ring;
  };
  if (geometry.type === 'Polygon') return { type: 'Polygon', coordinates: geometry.arcs.map(decodeRing) };
  if (geometry.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: geometry.arcs.map(polygon => polygon.map(decodeRing)) };
  return null;
}

function readCartographyPolicy() {
  if (!fs.existsSync(policySourcePath)) throw new Error(`Missing cartography policy: ${policySourcePath}`);
  const policy = JSON.parse(fs.readFileSync(policySourcePath, 'utf8'));
  const westernSaharaProfile = policy.activeProfiles.find(profile =>
    profile && profile.status === 'active-locked' &&
    Array.isArray(profile.affectedIso3) && profile.affectedIso3.includes('MAR') && profile.affectedIso3.includes('ESH')
  );
  if (!westernSaharaProfile) throw new Error('Missing active-locked MAR/ESH profile in CARTOGRAPHY_POLICY.json');
  return { policy, westernSaharaProfile };
}

function buildWesternSaharaSeparatedProfile(topology, countryGeometries, canonicalCountries, splitLat) {
  const marGeometry = countryGeometries.find(g => g.properties && g.properties.ISO_A3 === 'MAR');
  const canonicalEsh = canonicalCountries.find(c => countryCode(c.properties || {}) === 'ESH');
  const mar = marGeometry && topologyGeometryToGeoJson(topology, marGeometry);
  if (!mar || !canonicalEsh || !canonicalEsh.geometry) {
    throw new Error('Local source missing MAR or independent ESH geometry for policy split.');
  }
  const northMorocco = bboxClip(feature(mar), [-180, splitLat, 180, 90]);
  const westernPart = bboxClip(feature(mar), [-180, -90, 180, splitLat]);
  const completeWesternSahara = turfUnion(featureCollection([westernPart, feature(canonicalEsh.geometry)]));
  if (!northMorocco || !northMorocco.geometry || !completeWesternSahara || !completeWesternSahara.geometry) {
    throw new Error('Unable to build separated MAR/ESH outline profile.');
  }
  return { MAR: northMorocco.geometry, ESH: completeWesternSahara.geometry };
}

function countryCode(properties) {
  const candidates = [properties.ISO_A3, properties.ADM0_A3, properties.SU_A3, properties.GU_A3];
  for (const candidate of candidates) {
    if (candidate && candidate !== '-99') return String(candidate).toUpperCase();
  }
  return null;
}

function projectLabel(properties) {
  const lng = Number(properties.LABEL_X);
  const lat = Number(properties.LABEL_Y);
  return Number.isFinite(lng) && Number.isFinite(lat) ? projectPoint([lng, lat]) : null;
}

function buildStudio10mData(targetDataDir = dataDir) {
  const targetVectorsDir = path.join(targetDataDir, 'vectors');
  const targetCountriesDir = path.join(targetVectorsDir, 'country-outlines-studio10m');
  const targetIndexPath = path.join(targetVectorsDir, 'country-outlines-studio10m-index.json');

  const { policy, westernSaharaProfile } = readCartographyPolicy();
  const countriesFile = path.join(sourceDir, 'ne_10m_admin_0_countries.geojson');
  const topologyFile = path.join(profileSourceDir, 'countries_clipped.topojson');

  if (!fs.existsSync(countriesFile)) throw new Error(`Missing 10m countries source: ${countriesFile}`);
  if (!fs.existsSync(topologyFile)) throw new Error(`Missing topology source: ${topologyFile}`);

  const countriesData = JSON.parse(fs.readFileSync(countriesFile, 'utf8'));
  const topologyData = JSON.parse(fs.readFileSync(topologyFile, 'utf8'));
  const topologyGeometries = topologyData.objects && topologyData.objects.countries && topologyData.objects.countries.geometries;

  const westernSaharaSplit = buildWesternSaharaSeparatedProfile(
    topologyData,
    topologyGeometries,
    countriesData.features,
    westernSaharaProfile.build.splitLatitude
  );

  fs.mkdirSync(targetCountriesDir, { recursive: true });

  const indexEntries = {};
  let totalPointsGlobal = 0;
  let totalBytesGlobal = 0;

  // Process features sorted by ISO3 for strict determinism
  const sortedFeatures = [...countriesData.features].sort((a, b) => {
    const codeA = countryCode(a.properties || {}) || '';
    const codeB = countryCode(b.properties || {}) || '';
    return codeA.localeCompare(codeB);
  });

  const processedIso3 = new Set();

  for (const feat of sortedFeatures) {
    const properties = feat.properties || {};
    const iso3 = countryCode(properties);
    if (!iso3 || processedIso3.has(iso3)) continue;
    processedIso3.add(iso3);

    const iso2 = properties.ISO_A2 && properties.ISO_A2 !== '-99' ? String(properties.ISO_A2).toUpperCase() : '';
    const name = properties.NAME || properties.ADMIN || iso3;
    const nameLong = properties.NAME_LONG || properties.NAME || properties.ADMIN || iso3;
    const nameAr = properties.NAME_AR || '';
    const label = projectLabel(properties);

    let rings = [];
    let geometrySource = 'ne_10m_admin_0_countries';
    let policyProfile = 'standard-10m';

    if (westernSaharaSplit[iso3]) {
      rings = projectCountryOuterRingsExact(westernSaharaSplit[iso3]);
      geometrySource = iso3 === 'ESH' ? 'western-sahara-complete-territory-profile' : 'western-sahara-separated-profile';
      policyProfile = 'active-locked:western-sahara-separated-v1';

      // Validate expected geometry SHA256 against locked policy
      const expectedSha = westernSaharaProfile.expectedGeometrySha256[iso3];
      const actualSha = geometrySha256({ iso3, rings });
      if (expectedSha && actualSha !== expectedSha) {
        throw new Error(`Locked cartography geometry SHA256 mismatch for ${iso3}: expected ${expectedSha}, got ${actualSha}`);
      }
    } else {
      rings = projectCountryOuterRings(feat.geometry);
    }

    if (!rings.length) {
      console.warn(`[Studio10m] Warning: No rings for country ${iso3} (${name})`);
      continue;
    }

    let pointCount = 0;
    for (const ring of rings) {
      pointCount += ring.length;
      for (const pt of ring) {
        if (!Number.isFinite(pt[0]) || !Number.isFinite(pt[1]) || pt[0] < 0 || pt[0] > MAP_SIZE || pt[1] < 0 || pt[1] > MAP_SIZE) {
          throw new Error(`Out of bounds point in country ${iso3}: [${pt[0]}, ${pt[1]}]`);
        }
      }
    }

    if (pointCount > MAX_POINT_COUNT) {
      throw new Error(`Point count budget exceeded for country ${iso3}: ${pointCount} > ${MAX_POINT_COUNT}`);
    }

    const countryPayload = {
      schemaVersion: '1.0.0',
      dataTier: 'studio10m',
      iso3,
      iso2,
      name,
      nameLong,
      nameAr,
      label,
      pointCount,
      geometrySource,
      policyProfile,
      provenance: {
        sourceDataset: 'Natural Earth 1:10m Admin-0 Countries',
        cartographyPolicyVersion: policy.policyVersion
      },
      features: [
        {
          id: `studio-outline-${iso3}-01`,
          type: 'CountryLandOutline',
          iso3,
          isClosed: true,
          rings
        }
      ]
    };

    const jsonString = JSON.stringify(countryPayload);
    const jsonBuffer = Buffer.from(jsonString, 'utf8');

    if (jsonBuffer.length > MAX_FILE_BYTES) {
      throw new Error(`File size budget exceeded for country ${iso3}: ${jsonBuffer.length} > ${MAX_FILE_BYTES}`);
    }

    const countryFilePath = path.join(targetCountriesDir, `${iso3}.json`);
    fs.writeFileSync(countryFilePath, jsonBuffer);

    const relativeFile = `country-outlines-studio10m/${iso3}.json`;
    const fileSha256 = sha256Buffer(jsonBuffer);

    indexEntries[iso3] = {
      iso3,
      iso2,
      name,
      nameAr,
      relativeFile,
      bytes: jsonBuffer.length,
      sha256: fileSha256,
      pointCount,
      policyProfile
    };

    totalPointsGlobal += pointCount;
    totalBytesGlobal += jsonBuffer.length;
  }

  const sortedIndexKeys = Object.keys(indexEntries).sort();
  const sortedCountriesMap = {};
  for (const k of sortedIndexKeys) {
    sortedCountriesMap[k] = indexEntries[k];
  }

  const indexPayload = {
    schemaVersion: '1.0.0',
    dataTier: 'studio10m',
    policyVersion: policy.policyVersion,
    countryCount: sortedIndexKeys.length,
    totalPoints: totalPointsGlobal,
    totalBytes: totalBytesGlobal,
    countries: sortedCountriesMap
  };

  const indexString = JSON.stringify(indexPayload, null, 2) + '\n';
  fs.writeFileSync(targetIndexPath, Buffer.from(indexString, 'utf8'));

  const summary = `[OpenGeo] Studio 10m country outlines built: ${sortedIndexKeys.length} countries, ${totalPointsGlobal} points, ${totalBytesGlobal} bytes.`;
  console.log(summary);
  return {
    ok: true,
    countryCount: sortedIndexKeys.length,
    totalPoints: totalPointsGlobal,
    totalBytes: totalBytesGlobal,
    summary
  };
}

if (require.main === module) {
  try {
    buildStudio10mData();
  } catch (err) {
    console.error(`[Studio10m ERROR] ${err.message}`);
    process.exit(1);
  }
}

module.exports = { buildStudio10mData };
