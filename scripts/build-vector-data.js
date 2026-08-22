/*
 * Converts the checked-in Natural Earth GeoJSON source files to OpenGeo's
 * compact, Web-Mercator runtime contract. This script is deliberately manual:
 * builds/release verification never require the network.
 *
 * Expected input files (downloaded from nvkelso/natural-earth-vector):
 *   scripts/vector-data-sources/ne_50m_* or ne_10m_* (selected with --scale)
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const requestedScale = process.argv.find(argument => argument.indexOf('--scale=') === 0);
const requestedDataDir = process.argv.find(argument => argument.indexOf('--data-dir=') === 0);
const scale = requestedScale ? requestedScale.split('=')[1] : '50m';
if (scale !== '50m' && scale !== '10m') throw new Error('Supported scales are 50m and 10m.');
const sourceDir = path.join(root, 'scripts', 'vector-data-sources', 'natural-earth', scale);
const dataDir = requestedDataDir ? path.resolve(requestedDataDir.slice('--data-dir='.length))
  : path.join(root, 'client', 'assets', 'data');
const outputPath = path.join(dataDir, `world_vector_layers_${scale}.json`);
const MAP_SIZE = 262144;

function readGeoJson(filename) {
  const filePath = path.join(sourceDir, filename);
  if (!fs.existsSync(filePath)) throw new Error(`Missing vector source: ${filePath}`);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!data || !Array.isArray(data.features)) throw new Error(`Invalid FeatureCollection: ${filename}`);
  return data.features;
}

function projectPoint(point) {
  if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
  const lng = point[0];
  const lat = Math.max(-85.05112878, Math.min(85.05112878, point[1]));
  const sinLat = Math.sin(lat * Math.PI / 180);
  const x = ((lng + 180) / 360) * MAP_SIZE;
  const y = ((1 - Math.log((1 + sinLat) / (1 - sinLat)) / (2 * Math.PI)) / 2) * MAP_SIZE;
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
}

function convertLine(line, minimumPoints) {
  if (!Array.isArray(line)) return null;
  const result = [];
  for (let index = 0; index < line.length; index++) {
    const point = projectPoint(line[index]);
    if (!point) continue;
    const previous = result[result.length - 1];
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) result.push(point);
  }
  return result.length >= minimumPoints ? result : null;
}

function geometryToRings(geometry, closed) {
  if (!geometry || !geometry.type || !Array.isArray(geometry.coordinates)) return [];
  const lines = [];
  const add = (coordinates) => {
    const line = convertLine(coordinates, closed ? 3 : 2);
    if (line) lines.push(line);
  };
  if (geometry.type === 'Polygon' || geometry.type === 'MultiLineString') {
    geometry.coordinates.forEach(add);
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach(polygon => polygon.forEach(add));
  } else if (geometry.type === 'LineString') {
    add(geometry.coordinates);
  }
  return lines;
}

function labelPoint(properties) {
  const lng = Number(properties.LABEL_X);
  const lat = Number(properties.LABEL_Y);
  return Number.isFinite(lng) && Number.isFinite(lat) ? projectPoint([lng, lat]) : null;
}

function featureIdentity(properties, fallback) {
  return {
    iso2: properties.ISO_A2 || properties.ADM0_A3_US || '',
    iso3: properties.ISO_A3 || properties.ADM0_A3 || '',
    name: properties.NAME || properties.ADMIN || fallback,
    nameLong: properties.NAME_LONG || properties.NAME || properties.ADMIN || fallback,
    nameAr: properties.NAME_AR || ''
  };
}

function convertFeatures(features, options) {
  const converted = [];
  features.forEach((feature, index) => {
    const properties = feature.properties || {};
    const rings = geometryToRings(feature.geometry, options.closed);
    if (!rings.length) return;
    const identity = featureIdentity(properties, `${options.id} ${index + 1}`);
    converted.push({
      id: `${options.id}-${index + 1}`,
      iso2: identity.iso2,
      iso3: identity.iso3,
      name: identity.name,
      nameLong: identity.nameLong,
      nameAr: identity.nameAr,
      label: options.includeLabels ? labelPoint(properties) : null,
      isClosed: options.closed,
      rings
    });
  });
  return converted;
}

function build() {
  const countries = convertFeatures(readGeoJson(`ne_${scale}_admin_0_countries.geojson`), { id: 'land', closed: true, includeLabels: true });
  const borders = convertFeatures(readGeoJson(`ne_${scale}_admin_0_boundary_lines_land.geojson`), { id: 'border', closed: false, includeLabels: false });
  const coastlines = convertFeatures(readGeoJson(`ne_${scale}_coastline.geojson`), { id: 'coast', closed: false, includeLabels: false });
  const result = {
    version: '2.0.0',
    mapSize: MAP_SIZE,
    source: {
      name: 'Natural Earth Vector',
      scale: '1:' + scale,
      license: 'public-domain',
      generatedBy: 'scripts/build-vector-data.js',
      layers: ['ne_50m_admin_0_countries', 'ne_50m_admin_0_boundary_lines_land', 'ne_50m_coastline']
    },
    layers: {
      land: { isClosed: true, features: countries },
      borders: { isClosed: false, features: borders },
      coastlines: { isClosed: false, features: coastlines }
    }
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result), 'utf8');
  console.log(`[OpenGeo] Vector data built: land=${countries.length}, borders=${borders.length}, coastlines=${coastlines.length}`);
}

build();
