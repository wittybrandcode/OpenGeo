/*
 * Builds the exact local runtime data used by the Search → Draw workflow.
 * Geometry is never simplified: every source vertex is projected from WGS84
 * to OpenGeo's 262144px Web-Mercator world and retained.
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
const requestedDataDir = process.argv.find(argument => argument.indexOf('--data-dir=') === 0);
const dataDir = requestedDataDir ? path.resolve(requestedDataDir.slice('--data-dir='.length))
  : path.join(root, 'client', 'assets', 'data');
const outputDir = path.join(dataDir, 'vectors');
const MAP_SIZE = 262144;

function readCartographyPolicy() {
  if (!fs.existsSync(policySourcePath)) throw new Error(`Missing cartography policy: ${policySourcePath}`);
  const policy = JSON.parse(fs.readFileSync(policySourcePath, 'utf8'));
  if (!policy || policy.schemaVersion !== '1.0.0' || !policy.policyId || !policy.policyVersion ||
      !policy.governance || policy.governance.defaultDisputedBoundaryAuthority !== 'United Nations' ||
      !Array.isArray(policy.activeProfiles)) throw new Error('Cartography policy schema is invalid.');
  const westernSaharaProfile = policy.activeProfiles.find(profile => profile && profile.status === 'active-locked' &&
    Array.isArray(profile.affectedIso3) && profile.affectedIso3.includes('MAR') && profile.affectedIso3.includes('ESH'));
  if (!westernSaharaProfile || westernSaharaProfile.status !== 'active-locked' ||
      !westernSaharaProfile.build || !Number.isFinite(westernSaharaProfile.build.splitLatitude) ||
      !westernSaharaProfile.expectedGeometrySha256 || !Array.isArray(westernSaharaProfile.ruleIds) ||
      !westernSaharaProfile.ruleIds.length || !Array.isArray(westernSaharaProfile.sources)) {
    throw new Error('The locked MAR/ESH cartography profile is missing or incomplete.');
  }
  westernSaharaProfile.sources.forEach(source => {
    const sourcePath = source && source.path ? path.resolve(root, source.path) : null;
    if (!sourcePath || sourcePath.indexOf(root + path.sep) !== 0 || !fs.existsSync(sourcePath) ||
        !/^[a-f0-9]{64}$/.test(source.sha256 || '') || sha256(sourcePath) !== source.sha256) {
      throw new Error(`Cartography profile source provenance failed: ${(source && source.path) || 'unknown'}`);
    }
  });
  return { policy, westernSaharaProfile };
}

const policySource = readCartographyPolicy();
const CARTOGRAPHY_POLICY = policySource.policy;
const WESTERN_SAHARA_PROFILE = policySource.westernSaharaProfile;
const WESTERN_SAHARA_SPLIT_LAT = WESTERN_SAHARA_PROFILE.build.splitLatitude;

function readJson(filename) {
  const filePath = path.join(sourceDir, filename);
  if (!fs.existsSync(filePath)) throw new Error(`Missing canonical local vector source: ${filePath}`);
  return { filePath, data: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
}

function readProfileJson(filename) {
  const filePath = path.join(profileSourceDir, filename);
  if (!fs.existsSync(filePath)) throw new Error(`Missing local country-outline profile source: ${filePath}`);
  return { filePath, data: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function geometrySha256(feature) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ iso3: feature.iso3, rings: feature.rings }))
    .digest('hex');
}

function projectPoint(point) {
  if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
  const lng = point[0];
  const lat = Math.max(-85.05112878, Math.min(85.05112878, point[1]));
  const sinLat = Math.sin(lat * Math.PI / 180);
  // Do not quantize/round: source 10m geometry must remain exact.
  return [
    ((lng + 180) / 360) * MAP_SIZE,
    ((1 - Math.log((1 + sinLat) / (1 - sinLat)) / (2 * Math.PI)) / 2) * MAP_SIZE
  ];
}

function projectLine(line) {
  if (!Array.isArray(line)) return null;
  const points = [];
  for (let index = 0; index < line.length; index++) {
    const point = projectPoint(line[index]);
    if (point) points.push(point);
  }
  return points.length >= 2 ? points : null;
}

function projectLineGeometry(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  const lines = geometry.type === 'LineString' ? [geometry.coordinates]
    : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
  return lines.map(projectLine).filter(Boolean);
}

// A country polygon's exterior rings are the exact land perimeter: its
// international borders plus the coastline that bounds its land.  They are
// not EEZ/maritime-political lines. Holes are intentionally not exported,
// because lakes and other internal water bodies are not country borders.
function projectCountryOuterRings(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.map(polygon => {
    const projected = projectLine(polygon && polygon[0]);
    if (!projected) return null;
    // GeoJSON repeats the first point to close a ring. AE closes the Shape
    // itself, so remove only that exact duplicate — never a real vertex.
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

function projectTopologyCountryOuterRings(topology, geometry) {
  if (!geometry || !Array.isArray(geometry.arcs)) return [];
  const polygons = geometry.type === 'Polygon' ? [geometry.arcs]
    : geometry.type === 'MultiPolygon' ? geometry.arcs : [];
  return polygons.map(polygon => {
    const outerArcIndexes = polygon && polygon[0];
    if (!Array.isArray(outerArcIndexes)) return null;
    const projected = projectLine(joinTopologyArcs(topology, outerArcIndexes));
    if (!projected) return null;
    const first = projected[0];
    const last = projected[projected.length - 1];
    if (first && last && first[0] === last[0] && first[1] === last[1]) projected.pop();
    return projected.length >= 3 ? projected : null;
  }).filter(Boolean);
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

function buildWesternSaharaSeparatedProfile(topology, countryGeometries, canonicalCountries) {
  const marGeometry = countryGeometries.find(geometry => geometry.properties && geometry.properties.ISO_A3 === 'MAR');
  const canonicalEsh = canonicalCountries.find(country => countryCode(country.properties || {}) === 'ESH');
  const mar = marGeometry && topologyGeometryToGeoJson(topology, marGeometry);
  if (!mar || !canonicalEsh || !canonicalEsh.geometry) throw new Error('The local source set is missing the MAR or independent ESH geometry.');

  // Product contract: Morocco and Western Sahara are drawn independently.
  // The source set partitions Western Sahara between the MAR-administered
  // polygon and the narrow native ESH polygon. Build one complete ESH
  // territory locally, then publish it under the ESH identity only.
  const northMorocco = bboxClip(feature(mar), [-180, WESTERN_SAHARA_SPLIT_LAT, 180, 90]);
  const westernPart = bboxClip(feature(mar), [-180, -90, 180, WESTERN_SAHARA_SPLIT_LAT]);
  const completeWesternSahara = turfUnion(featureCollection([westernPart, feature(canonicalEsh.geometry)]));
  if (!northMorocco || !northMorocco.geometry || !completeWesternSahara || !completeWesternSahara.geometry) {
    throw new Error('Unable to build the separated MAR/ESH outline profile.');
  }
  return { MAR: northMorocco.geometry, ESH: completeWesternSahara.geometry };
}

function projectLabel(properties) {
  const lng = Number(properties.LABEL_X);
  const lat = Number(properties.LABEL_Y);
  return Number.isFinite(lng) && Number.isFinite(lat) ? projectPoint([lng, lat]) : null;
}

function countryCode(properties) {
  const candidates = [properties.ISO_A3, properties.ADM0_A3, properties.SU_A3, properties.GU_A3];
  for (const candidate of candidates) {
    if (candidate && candidate !== '-99') return String(candidate).toUpperCase();
  }
  return null;
}

function build() {
  const countriesInput = readJson('ne_10m_admin_0_countries.geojson');
  const bordersInput = readJson('ne_10m_admin_0_boundary_lines_land.geojson');
  const topologyInput = readProfileJson('countries_clipped.topojson');
  const topologyCountries = topologyInput.data.objects && topologyInput.data.objects.countries;
  if (!Array.isArray(countriesInput.data.features) || !Array.isArray(bordersInput.data.features) ||
      !topologyCountries || !Array.isArray(topologyCountries.geometries)) throw new Error('Canonical sources are incomplete.');

  const countries = {};
  const iso2ToIso3 = {};
  const sourceIso3Aliases = {};
  countriesInput.data.features.forEach(feature => {
    const properties = feature.properties || {};
    const iso3 = countryCode(properties);
    if (!iso3) return;
    const iso2 = properties.ISO_A2 && properties.ISO_A2 !== '-99' ? String(properties.ISO_A2).toUpperCase() : '';
    countries[iso3] = {
      iso3,
      iso2,
      name: properties.NAME || properties.ADMIN || iso3,
      nameLong: properties.NAME_LONG || properties.NAME || properties.ADMIN || iso3,
      nameAr: properties.NAME_AR || '',
      label: projectLabel(properties),
      borderIds: [],
      outlineIds: []
    };
    if (iso2) iso2ToIso3[iso2] = iso3;
    // Boundary-line attributes use administrative codes for a few entities
    // (for example PSX/SDS/SAH), while country identity uses ISO_A3. This is
    // identifier normalization only: it does not alter any geometry or
    // select a political-display profile.
    [properties.ADM0_A3, properties.SU_A3, properties.GU_A3].forEach(alias => {
      if (alias && alias !== '-99') sourceIso3Aliases[String(alias).toUpperCase()] = iso3;
    });
  });

  const outlineFeatures = [];
  const westernSaharaProfile = buildWesternSaharaSeparatedProfile(topologyInput.data, topologyCountries.geometries, countriesInput.data.features);
  topologyCountries.geometries.forEach(geometry => {
    const properties = geometry.properties || {};
    const iso3 = countryCode(properties);
    const country = iso3 && countries[iso3];
    const profileGeometry = westernSaharaProfile[iso3];
    const rings = profileGeometry ? projectCountryOuterRings(profileGeometry) : projectTopologyCountryOuterRings(topologyInput.data, geometry);
    if (!country || !rings.length) return;
    const id = `outline-${iso3}-${String(country.outlineIds.length + 1).padStart(2, '0')}`;
    outlineFeatures.push({
      id,
      type: 'CountryLandOutline',
      iso3,
      isClosed: true,
      geometrySource: iso3 === 'ESH' && profileGeometry
        ? 'western-sahara-complete-territory-profile'
        : profileGeometry ? 'western-sahara-separated-profile' : 'countries_clipped',
      rings
    });
    country.outlineIds.push(id);
  });

  Object.keys(WESTERN_SAHARA_PROFILE.expectedGeometrySha256).forEach(iso3 => {
    const outline = outlineFeatures.find(feature => feature.iso3 === iso3);
    const expected = WESTERN_SAHARA_PROFILE.expectedGeometrySha256[iso3];
    const actual = outline && geometrySha256(outline);
    if (!outline || actual !== expected) {
      throw new Error(`Locked cartography geometry changed for ${iso3}. Expected ${expected}, received ${actual || 'missing'}. Update the versioned policy only after explicit approval.`);
    }
  });

  // The supplied topology intentionally governs matching country codes (and
  // therefore MAR/ESH). A small number of legacy/exceptional world features
  // use a different code there, so retain a local Natural Earth fallback for
  // those countries rather than silently losing their outline.
  countriesInput.data.features.forEach(feature => {
    const properties = feature.properties || {};
    const iso3 = countryCode(properties);
    const country = iso3 && countries[iso3];
    if (!country || country.outlineIds.length) return;
    const rings = projectCountryOuterRings(feature.geometry);
    if (!rings.length) return;
    const id = `outline-${iso3}-${String(country.outlineIds.length + 1).padStart(2, '0')}`;
    outlineFeatures.push({
      id,
      type: 'CountryLandOutline',
      iso3,
      isClosed: true,
      geometrySource: 'natural-earth-fallback',
      rings
    });
    country.outlineIds.push(id);
  });

  const features = [];
  let rejectedNonLand = 0;
  bordersInput.data.features.forEach(feature => {
    const properties = feature.properties || {};
    // The filename alone is insufficient: Natural Earth includes Water
    // Indicator entries here. Only exact terrestrial international borders
    // are admitted into the default OpenGeo drawing source.
    if (properties.TYPE !== 'Land') {
      rejectedNonLand++;
      return;
    }
    const leftSourceCode = properties.ADM0_A3_L && properties.ADM0_A3_L !== '-99' ? String(properties.ADM0_A3_L).toUpperCase() : '';
    const rightSourceCode = properties.ADM0_A3_R && properties.ADM0_A3_R !== '-99' ? String(properties.ADM0_A3_R).toUpperCase() : '';
    const leftIso3 = sourceIso3Aliases[leftSourceCode] || leftSourceCode;
    const rightIso3 = sourceIso3Aliases[rightSourceCode] || rightSourceCode;
    const rings = projectLineGeometry(feature.geometry);
    if (!leftIso3 || !rightIso3 || !rings.length) return;
    const id = `land-${String(features.length + 1).padStart(4, '0')}`;
    features.push({
      id,
      type: 'Land',
      leftIso3,
      rightIso3,
      leftName: properties.ADM0_LEFT || leftIso3,
      rightName: properties.ADM0_RIGHT || rightIso3,
      isClosed: false,
      rings
    });
    if (countries[leftIso3]) countries[leftIso3].borderIds.push(id);
    if (countries[rightIso3]) countries[rightIso3].borderIds.push(id);
  });

  fs.mkdirSync(outputDir, { recursive: true });
  const borderPackage = {
    version: '1.0.0',
    cartographyPolicyVersion: CARTOGRAPHY_POLICY.policyVersion,
    mapSize: MAP_SIZE,
    source: 'Natural Earth Vector 1:10m — Admin 0 Boundary Lines Land',
    selectionRule: 'TYPE === Land',
    features
  };
  const outlinePackage = {
    version: '1.0.0',
    cartographyPolicyVersion: CARTOGRAPHY_POLICY.policyVersion,
    mapSize: MAP_SIZE,
    source: 'OpenGeo countries_clipped topology with Natural Earth 10m — complete separated MAR/ESH territory profile',
    selectionRule: 'topological country exterior rings; ESH is reconstructed once at build time from the partitioned source polygons; no holes, EEZ, or maritime-political lines',
    activeProfile: {
      id: WESTERN_SAHARA_PROFILE.profileId,
      splitLatitude: WESTERN_SAHARA_SPLIT_LAT,
      morocco: WESTERN_SAHARA_PROFILE.build.morocco,
      westernSahara: WESTERN_SAHARA_PROFILE.build.westernSahara
    },
    features: outlineFeatures
  };
  const countryIndex = {
    version: '1.0.0',
    cartographyPolicyVersion: CARTOGRAPHY_POLICY.policyVersion,
    source: 'Natural Earth Vector 1:10m — Admin 0 Countries',
    countries: Object.keys(countries).reduce((runtimeCountries, iso3) => {
      const country = countries[iso3];
      runtimeCountries[iso3] = {
        iso3: country.iso3,
        iso2: country.iso2,
        name: country.name,
        nameLong: country.nameLong,
        nameAr: country.nameAr,
        label: country.label,
        outlineIds: country.outlineIds
      };
      return runtimeCountries;
    }, {}),
    iso2ToIso3
  };
  const countriesWithoutLandBorders = Object.keys(countries)
    .filter(iso3 => countries[iso3].borderIds.length === 0)
    .sort();
  const manifest = {
    version: '1.0.0',
    generator: 'scripts/build-land-border-data.js',
    cartographyPolicy: {
      id: CARTOGRAPHY_POLICY.policyId,
      version: CARTOGRAPHY_POLICY.policyVersion,
      sourceSha256: sha256(policySourcePath)
    },
    geometryPolicy: 'no simplification; full-precision Web-Mercator projection only',
    activeProfile: {
      id: WESTERN_SAHARA_PROFILE.profileId,
      splitLatitude: WESTERN_SAHARA_SPLIT_LAT,
      contract: 'MAR and ESH are separate outlines; no default unified Morocco geometry.'
    },
    sourceFiles: [
      { file: path.relative(root, countriesInput.filePath).replace(/\\/g, '/'), sha256: sha256(countriesInput.filePath) },
      { file: path.relative(root, bordersInput.filePath).replace(/\\/g, '/'), sha256: sha256(bordersInput.filePath) },
      { file: path.relative(root, topologyInput.filePath).replace(/\\/g, '/'), sha256: sha256(topologyInput.filePath) },
      { file: path.relative(root, policySourcePath).replace(/\\/g, '/'), sha256: sha256(policySourcePath) }
    ],
    input: { borderFeatures: bordersInput.data.features.length, rejectedNonLand },
    output: {
      landBorderFeatures: features.length,
      countryOutlineFeatures: outlineFeatures.length,
      topologyOutlineFeatures: outlineFeatures.filter(feature => feature.geometrySource === 'countries_clipped').length,
      fallbackOutlineFeatures: outlineFeatures.filter(feature => feature.geometrySource === 'natural-earth-fallback').length,
      indexedCountries: Object.keys(countries).length,
      countriesWithoutLandBorders
    }
  };
  fs.writeFileSync(path.join(outputDir, 'land-borders-10m.json'), JSON.stringify(borderPackage), 'utf8');
  fs.writeFileSync(path.join(outputDir, 'country-outlines-10m.json'), JSON.stringify(outlinePackage), 'utf8');
  fs.writeFileSync(path.join(outputDir, 'country-index-10m.json'), JSON.stringify(countryIndex), 'utf8');
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  fs.writeFileSync(path.join(outputDir, 'cartography-policy.json'), JSON.stringify(Object.assign({}, CARTOGRAPHY_POLICY, {
    sourcePolicySha256: sha256(policySourcePath),
    generatedBy: 'scripts/build-land-border-data.js'
  }), null, 2), 'utf8');
  console.log(`[OpenGeo] Local country-outline source built: ${outlineFeatures.length} separated country outlines from countries_clipped topology; ${features.length} indexed international Land lines; rejected ${rejectedNonLand} Water Indicator/non-land features.`);
}

build();
