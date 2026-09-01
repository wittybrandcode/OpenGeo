/** Pure exact-set coverage gate shared by Sync, trajectory preview and Finalize. */
class CoverageContract {
  static evaluate(plan, results, expandedPlacements) {
    const downloads = Array.isArray(plan) ? plan : [];
    const placements = Array.isArray(downloads.placements) ? downloads.placements : [];
    const samples = Array.isArray(downloads.coverageSamples) ? downloads.coverageSamples : [];
    const settledResults = Array.isArray(results) ? results : [];

    const plannedDownloadKeys = downloads.map(item => String(item && item.downloadKey || ''));
    const plannedPlacementKeys = placements.map(item => String(item && item.placementKey || ''));
    const downloadSet = new Set(plannedDownloadKeys.filter(Boolean));
    const placementSet = new Set(plannedPlacementKeys.filter(Boolean));
    const duplicateDownloadKeys = CoverageContract._duplicates(plannedDownloadKeys);
    const duplicatePlannedPlacementKeys = CoverageContract._duplicates(plannedPlacementKeys);
    const stateByDownload = new Map();
    const unexpectedDownloadKeys = new Set();
    const duplicateCompletedDownloadKeys = new Set();

    for (const result of settledResults) {
      const key = CoverageContract._downloadKey(result);
      if (!key) continue;
      if (!downloadSet.has(key)) unexpectedDownloadKeys.add(key);
      let state = stateByDownload.get(key);
      if (!state) {
        state = { complete: 0, cached: 0, failed: 0, cancelled: 0 };
        stateByDownload.set(key, state);
      }
      const status = CoverageContract._status(result);
      if (status === 'complete') state.complete++;
      else if (status === 'cached') state.cached++;
      else if (status === 'cancelled') state.cancelled++;
      else state.failed++;
      if (state.complete + state.cached > 1) duplicateCompletedDownloadKeys.add(key);
    }

    const completedDownloadKeys = new Set();
    const cachedDownloadKeys = new Set();
    const cancelledDownloadKeys = new Set();
    for (const key of downloadSet) {
      const state = stateByDownload.get(key);
      if (state && state.cached > 0) cachedDownloadKeys.add(key);
      else if (state && state.complete > 0) completedDownloadKeys.add(key);
      else if (state && state.cancelled > 0) cancelledDownloadKeys.add(key);
    }
    const availableDownloadKeys = new Set([...completedDownloadKeys, ...cachedDownloadKeys]);
    const missingDownloadKeys = Array.from(downloadSet).filter(key => !availableDownloadKeys.has(key)).sort();
    const failedDownloadKeys = Array.from(downloadSet).filter(key => {
      const state = stateByDownload.get(key);
      return !availableDownloadKeys.has(key) && !!(state && state.failed > 0);
    }).sort();

    const expanded = Array.isArray(expandedPlacements)
      ? expandedPlacements
      : placements.filter(placement => availableDownloadKeys.has(String(placement.downloadKey || '')));
    const expandedPlacementKeys = expanded.map(item => String(item && item.placementKey || ''));
    const expandedPlacementSet = new Set(expandedPlacementKeys.filter(Boolean));
    const duplicatePlacementKeys = CoverageContract._duplicates(expandedPlacementKeys);
    const missingPlacementKeys = Array.from(placementSet).filter(key => !expandedPlacementSet.has(key)).sort();
    const unexpectedPlacementKeys = Array.from(expandedPlacementSet).filter(key => !placementSet.has(key)).sort();
    const trajectory = CoverageContract.evaluateTrajectory(samples, expandedPlacementKeys);

    const malformedCoverageSamples = samples.length === 0 || samples.some(sample =>
      !sample || sample.sampleId === undefined || !Array.isArray(sample.requiredPlacementKeys)
    );
    const malformedPlan = plannedDownloadKeys.length === 0 || plannedPlacementKeys.length === 0 ||
      plannedDownloadKeys.some(key => !key) || plannedPlacementKeys.some(key => !key) ||
      malformedCoverageSamples;
    const result = {
      schemaVersion: 'coverage-result/1.0',
      samples: samples.length,
      plannedPlacements: plannedPlacementKeys.length,
      uniqueDownloads: downloadSet.size,
      completedDownloads: completedDownloadKeys.size,
      cachedDownloads: cachedDownloadKeys.size,
      failedDownloads: failedDownloadKeys.length,
      cancelledDownloads: cancelledDownloadKeys.size,
      expandedPlacements: expandedPlacementKeys.length,
      completedDownloadKeys: Array.from(completedDownloadKeys).sort(),
      cachedDownloadKeys: Array.from(cachedDownloadKeys).sort(),
      failedDownloadKeys,
      cancelledDownloadKeys: Array.from(cancelledDownloadKeys).sort(),
      missingDownloadKeys,
      missingPlacementKeys,
      unexpectedDownloadKeys: Array.from(unexpectedDownloadKeys).sort(),
      duplicateDownloadKeys,
      duplicateCompletedDownloadKeys: Array.from(duplicateCompletedDownloadKeys).sort(),
      duplicatePlannedPlacementKeys,
      duplicatePlacementKeys,
      unexpectedPlacementKeys,
      uncoveredSampleIds: trajectory.uncoveredSampleIds,
      missingBySample: trajectory.missingBySample,
      malformedPlan
    };
    result.ok = !malformedPlan &&
      result.completedDownloads + result.cachedDownloads === result.uniqueDownloads &&
      result.expandedPlacements === result.plannedPlacements &&
      result.missingDownloadKeys.length === 0 &&
      result.missingPlacementKeys.length === 0 &&
      result.unexpectedDownloadKeys.length === 0 &&
      result.duplicateDownloadKeys.length === 0 &&
      result.duplicateCompletedDownloadKeys.length === 0 &&
      result.duplicatePlannedPlacementKeys.length === 0 &&
      result.duplicatePlacementKeys.length === 0 &&
      result.unexpectedPlacementKeys.length === 0 &&
      result.uncoveredSampleIds.length === 0;
    return result;
  }

  static assertCompleteCoverage(plan, results, expandedPlacements) {
    const coverage = CoverageContract.evaluate(plan, results, expandedPlacements);
    if (coverage.ok) return coverage;
    const error = new Error(
      `Incomplete tile coverage: downloads ${coverage.completedDownloads + coverage.cachedDownloads}/${coverage.uniqueDownloads}, ` +
      `placements ${coverage.expandedPlacements}/${coverage.plannedPlacements}, uncovered samples ${coverage.uncoveredSampleIds.length}.`
    );
    error.name = 'OpenGeoCoverageError';
    error.code = 'OPEN_GEO_INCOMPLETE_COVERAGE';
    error.details = CoverageContract.safeDetails(coverage);
    throw error;
  }

  static evaluateTrajectory(samples, observedPlacementKeys) {
    const observed = new Set((Array.isArray(observedPlacementKeys) ? observedPlacementKeys : []).map(String));
    const missingBySample = {};
    const uncoveredSampleIds = [];
    for (let index = 0; index < (Array.isArray(samples) ? samples.length : 0); index++) {
      const sample = samples[index] || {};
      const sampleId = String(sample.sampleId !== undefined ? sample.sampleId : `sample-${index}`);
      const required = Array.isArray(sample.requiredPlacementKeys) ? sample.requiredPlacementKeys.map(String) : [];
      const missing = required.filter(key => !observed.has(key));
      if (missing.length) {
        missingBySample[sampleId] = missing.sort();
        uncoveredSampleIds.push(sampleId);
      }
    }
    return { ok: uncoveredSampleIds.length === 0, missingBySample, uncoveredSampleIds };
  }

  static compareExactSets(expectedValues, actualValues) {
    const expectedList = (Array.isArray(expectedValues) ? expectedValues : []).map(String);
    const actualList = (Array.isArray(actualValues) ? actualValues : []).map(String);
    const expected = new Set(expectedList);
    const actual = new Set(actualList);
    const missing = Array.from(expected).filter(value => !actual.has(value)).sort();
    const unexpected = Array.from(actual).filter(value => !expected.has(value)).sort();
    const duplicateExpected = CoverageContract._duplicates(expectedList);
    const duplicateActual = CoverageContract._duplicates(actualList);
    return {
      ok: missing.length === 0 && unexpected.length === 0 && duplicateExpected.length === 0 && duplicateActual.length === 0,
      missing,
      unexpected,
      duplicateExpected,
      duplicateActual
    };
  }

  static safeDetails(coverage) {
    const safe = {};
    const scalarKeys = [
      'schemaVersion', 'plannedPlacements', 'uniqueDownloads', 'completedDownloads',
      'cachedDownloads', 'failedDownloads', 'cancelledDownloads', 'expandedPlacements', 'malformedPlan'
    ];
    const identityKeys = [
      'missingDownloadKeys', 'missingPlacementKeys', 'unexpectedDownloadKeys',
      'duplicateDownloadKeys', 'duplicateCompletedDownloadKeys', 'duplicatePlannedPlacementKeys',
      'duplicatePlacementKeys', 'unexpectedPlacementKeys', 'uncoveredSampleIds'
    ];
    for (const key of scalarKeys) safe[key] = coverage[key];
    for (const key of identityKeys) safe[key] = (coverage[key] || []).slice(0, 50);
    return safe;
  }

  static _downloadKey(result) {
    if (!result) return '';
    return String(result.downloadKey || (result.tile && result.tile.downloadKey) || '');
  }

  static _status(result) {
    if (!result) return 'failed';
    if ((result.status === 'cached' || result.cached === true) && result.filePath) return 'cached';
    if (result.status === 'complete' && result.filePath) return 'complete';
    if (result.status === 'cancelled') return 'cancelled';
    return 'failed';
  }

  static _duplicates(values) {
    const seen = new Set();
    const duplicates = new Set();
    for (const value of values) {
      if (!value) continue;
      if (seen.has(value)) duplicates.add(value);
      else seen.add(value);
    }
    return Array.from(duplicates).sort();
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = CoverageContract;
else if (typeof window !== 'undefined') window.CoverageContract = CoverageContract;
