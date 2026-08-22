const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const goldenPath = path.resolve(__dirname, 'geometry-fixtures/country-outlines-golden.json');

function nearlyEqual(actual, expected, tolerance) {
  return Math.abs(actual - expected) <= tolerance;
}

function orientation(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointOnSegment(point, a, b, epsilon) {
  if (Math.abs(orientation(a, b, point)) > epsilon) return false;
  return point[0] >= Math.min(a[0], b[0]) - epsilon &&
    point[0] <= Math.max(a[0], b[0]) + epsilon &&
    point[1] >= Math.min(a[1], b[1]) - epsilon &&
    point[1] <= Math.max(a[1], b[1]) + epsilon;
}

function segmentBoundsOverlap(a, b, c, d, epsilon) {
  return Math.max(a[0], b[0]) + epsilon >= Math.min(c[0], d[0]) &&
    Math.max(c[0], d[0]) + epsilon >= Math.min(a[0], b[0]) &&
    Math.max(a[1], b[1]) + epsilon >= Math.min(c[1], d[1]) &&
    Math.max(c[1], d[1]) + epsilon >= Math.min(a[1], b[1]);
}

function segmentIntersectionKind(a, b, c, d, epsilon) {
  if (!segmentBoundsOverlap(a, b, c, d, epsilon)) return 'none';
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  const oppositeFirst = (first > epsilon && second < -epsilon) || (first < -epsilon && second > epsilon);
  const oppositeSecond = (third > epsilon && fourth < -epsilon) || (third < -epsilon && fourth > epsilon);
  if (oppositeFirst && oppositeSecond) return 'proper';
  if (Math.abs(first) <= epsilon && pointOnSegment(c, a, b, epsilon)) return 'touch';
  if (Math.abs(second) <= epsilon && pointOnSegment(d, a, b, epsilon)) return 'touch';
  if (Math.abs(third) <= epsilon && pointOnSegment(a, c, d, epsilon)) return 'touch';
  if (Math.abs(fourth) <= epsilon && pointOnSegment(b, c, d, epsilon)) return 'touch';
  return 'none';
}

function ringArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length; index++) {
    const point = ring[index];
    const next = ring[(index + 1) % ring.length];
    area += point[0] * next[1] - next[0] * point[1];
  }
  return Math.abs(area / 2);
}

function ringBounds(ring) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  ring.forEach(point => {
    bounds[0] = Math.min(bounds[0], point[0]);
    bounds[1] = Math.min(bounds[1], point[1]);
    bounds[2] = Math.max(bounds[2], point[0]);
    bounds[3] = Math.max(bounds[3], point[1]);
  });
  return bounds;
}

function boundsHaveInteriorOverlap(first, second, epsilon) {
  return Math.min(first[2], second[2]) - Math.max(first[0], second[0]) > epsilon &&
    Math.min(first[3], second[3]) - Math.max(first[1], second[1]) > epsilon;
}

function pointInRing(point, ring, epsilon) {
  for (let index = 0; index < ring.length; index++) {
    if (pointOnSegment(point, ring[index], ring[(index + 1) % ring.length], epsilon)) return 'boundary';
  }
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    const crosses = (currentPoint[1] > point[1]) !== (previousPoint[1] > point[1]);
    if (crosses && point[0] < ((previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1]) /
        (previousPoint[1] - currentPoint[1])) + currentPoint[0]) inside = !inside;
  }
  return inside ? 'inside' : 'outside';
}

function pointInFeature(point, feature, epsilon) {
  let boundary = false;
  for (const ring of feature.rings) {
    const result = pointInRing(point, ring, epsilon);
    if (result === 'inside') return 'inside';
    if (result === 'boundary') boundary = true;
  }
  return boundary ? 'boundary' : 'outside';
}

function countSelfIntersections(ring, epsilon) {
  let count = 0;
  for (let first = 0; first < ring.length; first++) {
    for (let second = first + 1; second < ring.length; second++) {
      if (second === first + 1 || (first === 0 && second === ring.length - 1)) continue;
      if (segmentIntersectionKind(
        ring[first], ring[(first + 1) % ring.length],
        ring[second], ring[(second + 1) % ring.length], epsilon
      ) !== 'none') count++;
    }
  }
  return count;
}

function ringsUnexpectedlyOverlap(first, second, epsilon) {
  const firstBounds = ringBounds(first);
  const secondBounds = ringBounds(second);
  if (!boundsHaveInteriorOverlap(firstBounds, secondBounds, epsilon)) return false;
  for (let firstIndex = 0; firstIndex < first.length; firstIndex++) {
    for (let secondIndex = 0; secondIndex < second.length; secondIndex++) {
      if (segmentIntersectionKind(
        first[firstIndex], first[(firstIndex + 1) % first.length],
        second[secondIndex], second[(secondIndex + 1) % second.length], epsilon
      ) === 'proper') return true;
    }
  }
  return first.some(point => pointInRing(point, second, epsilon) === 'inside') ||
    second.some(point => pointInRing(point, first, epsilon) === 'inside');
}

function countUnexpectedRingOverlaps(rings, epsilon) {
  let count = 0;
  for (let first = 0; first < rings.length; first++) {
    for (let second = first + 1; second < rings.length; second++) {
      if (ringsUnexpectedlyOverlap(rings[first], rings[second], epsilon)) count++;
    }
  }
  return count;
}

function collinearOverlapLength(a, b, c, d, epsilon) {
  if (Math.abs(orientation(a, b, c)) > epsilon || Math.abs(orientation(a, b, d)) > epsilon) return 0;
  const deltaX = b[0] - a[0];
  const deltaY = b[1] - a[1];
  const length = Math.hypot(deltaX, deltaY);
  if (length <= epsilon) return 0;
  const unitX = deltaX / length;
  const unitY = deltaY / length;
  const start = (c[0] - a[0]) * unitX + (c[1] - a[1]) * unitY;
  const end = (d[0] - a[0]) * unitX + (d[1] - a[1]) * unitY;
  return Math.max(0, Math.min(length, Math.max(start, end)) - Math.max(0, Math.min(start, end)));
}

function analyzeRelationship(first, second, epsilon) {
  let properBoundaryCrossings = 0;
  let sharedBoundaryLength = 0;
  for (const firstRing of first.rings) {
    for (const secondRing of second.rings) {
      for (let firstIndex = 0; firstIndex < firstRing.length; firstIndex++) {
        for (let secondIndex = 0; secondIndex < secondRing.length; secondIndex++) {
          const a = firstRing[firstIndex];
          const b = firstRing[(firstIndex + 1) % firstRing.length];
          const c = secondRing[secondIndex];
          const d = secondRing[(secondIndex + 1) % secondRing.length];
          if (segmentIntersectionKind(a, b, c, d, epsilon) === 'proper') properBoundaryCrossings++;
          sharedBoundaryLength += collinearOverlapLength(a, b, c, d, epsilon);
        }
      }
    }
  }
  let interiorVertexOverlaps = 0;
  first.rings.forEach(ring => ring.forEach(point => {
    if (pointInFeature(point, second, epsilon) === 'inside') interiorVertexOverlaps++;
  }));
  second.rings.forEach(ring => ring.forEach(point => {
    if (pointInFeature(point, first, epsilon) === 'inside') interiorVertexOverlaps++;
  }));
  return { properBoundaryCrossings, sharedBoundaryLength, interiorVertexOverlaps };
}

function computeFeatureMetrics(feature, mapSize, epsilon) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  let pointCount = 0;
  let projectedArea = 0;
  let selfIntersections = 0;
  let maximumSegmentDeltaX = 0;
  const validityErrors = [];
  if (!feature || feature.type !== 'CountryLandOutline' || feature.isClosed !== true || !Array.isArray(feature.rings)) {
    return { validityErrors: ['invalid feature contract'] };
  }
  feature.rings.forEach((ring, ringIndex) => {
    if (!Array.isArray(ring) || ring.length < 3) {
      validityErrors.push(`ring ${ringIndex} has fewer than three vertices`);
      return;
    }
    projectedArea += ringArea(ring);
    selfIntersections += countSelfIntersections(ring, epsilon);
    ring.forEach((point, pointIndex) => {
      if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
        validityErrors.push(`ring ${ringIndex} point ${pointIndex} is not finite`);
        return;
      }
      if (point[0] < -epsilon || point[0] > mapSize + epsilon || point[1] < -epsilon || point[1] > mapSize + epsilon) {
        validityErrors.push(`ring ${ringIndex} point ${pointIndex} is outside the projected world`);
      }
      const next = ring[(pointIndex + 1) % ring.length];
      if (next && nearlyEqual(point[0], next[0], epsilon) && nearlyEqual(point[1], next[1], epsilon)) {
        validityErrors.push(`ring ${ringIndex} contains a zero-length edge at point ${pointIndex}`);
      }
      if (next) maximumSegmentDeltaX = Math.max(maximumSegmentDeltaX, Math.abs(next[0] - point[0]));
      bounds[0] = Math.min(bounds[0], point[0]);
      bounds[1] = Math.min(bounds[1], point[1]);
      bounds[2] = Math.max(bounds[2], point[0]);
      bounds[3] = Math.max(bounds[3], point[1]);
      pointCount++;
    });
  });
  if (!(projectedArea > epsilon)) validityErrors.push('feature has no positive projected area');
  return {
    ringCount: feature.rings.length,
    pointCount,
    bbox: bounds,
    projectedArea,
    geometrySha256: crypto.createHash('sha256')
      .update(JSON.stringify({ iso3: feature.iso3, rings: feature.rings }))
      .digest('hex'),
    selfIntersections,
    unexpectedRingOverlaps: countUnexpectedRingOverlaps(feature.rings, epsilon),
    maximumSegmentDeltaX,
    validityErrors
  };
}

function verifyGeometry(options = {}) {
  const fixture = JSON.parse(fs.readFileSync(options.goldenPath || goldenPath, 'utf8'));
  const outlinesPath = options.dataDir
    ? path.resolve(options.dataDir, 'vectors/country-outlines-10m.json')
    : path.resolve(root, fixture.dataset.outlinesPath);
  const indexPath = options.dataDir
    ? path.resolve(options.dataDir, 'vectors/country-index-10m.json')
    : path.resolve(root, fixture.dataset.indexPath);
  const outlines = JSON.parse(fs.readFileSync(outlinesPath, 'utf8'));
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const epsilon = fixture.tolerances.coordinate;
  const failures = [];
  let checks = 0;
  const check = (condition, message) => {
    checks++;
    if (!condition) failures.push(message);
  };
  check(outlines.version === fixture.dataset.version, `dataset version changed: ${outlines.version}`);
  check(outlines.cartographyPolicyVersion === fixture.dataset.cartographyPolicyVersion,
    `cartography policy changed: ${outlines.cartographyPolicyVersion}`);
  check(outlines.mapSize === fixture.dataset.mapSize, `map size changed: ${outlines.mapSize}`);
  const features = new Map(outlines.features.map(feature => [feature.iso3, feature]));
  const metrics = {};
  for (const [iso3, expected] of Object.entries(fixture.countries)) {
    const feature = features.get(iso3);
    const country = index.countries[iso3];
    check(Boolean(feature), `${iso3}: golden feature is missing`);
    check(Boolean(country), `${iso3}: country index entry is missing`);
    if (!feature || !country) continue;
    const actual = computeFeatureMetrics(feature, outlines.mapSize, epsilon);
    metrics[iso3] = actual;
    check(feature.iso3 === iso3 && country.iso3 === iso3, `${iso3}: identity mismatch`);
    check(actual.validityErrors.length === 0, `${iso3}: ${actual.validityErrors.join('; ')}`);
    check(actual.ringCount === expected.ringCount, `${iso3}: ring count ${actual.ringCount} != ${expected.ringCount}`);
    check(actual.pointCount === expected.pointCount, `${iso3}: point count ${actual.pointCount} != ${expected.pointCount}`);
    check(actual.bbox.every((value, indexValue) => nearlyEqual(value, expected.bbox[indexValue], fixture.tolerances.bbox)),
      `${iso3}: bounding box drifted`);
    check(nearlyEqual(actual.projectedArea, expected.projectedArea,
      Math.max(1, expected.projectedArea) * fixture.tolerances.areaRelative), `${iso3}: projected area drifted`);
    check(actual.geometrySha256 === expected.geometrySha256, `${iso3}: geometry SHA-256 drifted`);
    check(actual.selfIntersections === expected.selfIntersections,
      `${iso3}: self-intersections ${actual.selfIntersections} != ${expected.selfIntersections}`);
    check(actual.unexpectedRingOverlaps === expected.unexpectedRingOverlaps,
      `${iso3}: multipart overlap count ${actual.unexpectedRingOverlaps} != ${expected.unexpectedRingOverlaps}`);
    const labelInside = Array.isArray(country.label) && pointInFeature(country.label, feature, epsilon) !== 'outside';
    check(labelInside === expected.labelInside, `${iso3}: label is not inside its selected country geometry`);
    if (expected.expectAntimeridianSplit) {
      check(actual.bbox[0] <= epsilon && actual.bbox[2] >= outlines.mapSize - epsilon,
        `${iso3}: antimeridian edge coverage is incomplete`);
      check(actual.maximumSegmentDeltaX < outlines.mapSize / 2,
        `${iso3}: an unsplit ring crosses the whole projected world`);
    }
  }
  for (const [relationshipId, expected] of Object.entries(fixture.relationships)) {
    const first = features.get(expected.firstIso3);
    const second = features.get(expected.secondIso3);
    check(Boolean(first && second), `${relationshipId}: relationship feature missing`);
    if (!first || !second) continue;
    const actual = analyzeRelationship(first, second, epsilon);
    check(actual.properBoundaryCrossings === expected.properBoundaryCrossings,
      `${relationshipId}: unexpected proper boundary crossing`);
    check(actual.interiorVertexOverlaps === expected.interiorVertexOverlaps,
      `${relationshipId}: one territory contains vertices from the other`);
    check(nearlyEqual(actual.sharedBoundaryLength, expected.sharedBoundaryLength,
      fixture.tolerances.sharedBoundaryLength), `${relationshipId}: shared boundary length drifted`);
    if (expected.sharedBoundaryAxis === 'horizontal') {
      const firstBounds = metrics[expected.firstIso3].bbox;
      const secondBounds = metrics[expected.secondIso3].bbox;
      check(nearlyEqual(firstBounds[3], expected.sharedBoundaryCoordinate, fixture.tolerances.bbox) &&
        nearlyEqual(secondBounds[1], expected.sharedBoundaryCoordinate, fixture.tolerances.bbox),
      `${relationshipId}: the reviewed horizontal separation coordinate drifted`);
    }
  }
  return {
    ok: failures.length === 0,
    checks,
    fixtureCount: Object.keys(fixture.countries).length,
    relationshipCount: Object.keys(fixture.relationships).length,
    failures,
    metrics
  };
}

if (require.main === module) {
  try {
    const result = verifyGeometry();
    if (!result.ok) {
      console.error(`[OpenGeo] Golden geometry verification failed (${result.failures.length}/${result.checks} checks):`);
      result.failures.forEach(failure => console.error(`  - ${failure}`));
      process.exit(1);
    }
    console.log(`[OpenGeo] Golden geometry verified: ${result.checks} checks, ${result.fixtureCount} countries, ${result.relationshipCount} relationship.`);
  } catch (error) {
    console.error(`[OpenGeo] Golden geometry verification crashed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  verifyGeometry,
  computeFeatureMetrics,
  analyzeRelationship,
  pointInFeature
};
