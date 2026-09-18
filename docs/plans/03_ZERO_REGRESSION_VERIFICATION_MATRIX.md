# OpenGeo — Zero-Regression Verification Matrix & Safety Gates

> **Objective:** Ensure 100% operational continuity across all 162 automated test suites during and after every refactoring phase.  
> **Rule:** If any single test fails, the refactoring step is immediately rejected and rolled back.  

---

## 1. Automated Test Suite Mapping

| Refactored Module | Associated Test Suites | Exact Test Commands | Pass Criteria |
| :--- | :--- | :--- | :--- |
| **`Viewport.js`** | • `scripts/tests/map/viewport-resize.test.js`<br>• `scripts/tests/map/pitch-3d.test.js` | `node scripts/tests/map/viewport-resize.test.js`<br>`node scripts/tests/map/pitch-3d.test.js` | 101/101 passed<br>51/51 passed |
| **`CoveragePlanner.js`** | • `scripts/tests/map/pitch-3d.test.js`<br>• Master QA Suite | `node scripts/tests/map/pitch-3d.test.js`<br>`npm test` | Zero black void<br>3D overscan valid |
| **`OpenGeoEngine.js`** | • Master QA Suite (Tests 20–25, 48–52)<br>• Invalidation & Provider tests | `npm test` | Frame-coalesced<br>Clean provider switch |
| **`GeoDataRepository.js`** | • Master QA Suite (Tests 60, 77, 78)<br>• Chunk read & memory eviction | `npm test`<br>`node scripts/runtime-data-contract.js` | Zero memory leak<br>Valid GeoJSON chunks |
| **`FinalizeController.js`** | • Master QA Suite (Tests 1–4, 34–36, 68–71)<br>• Soft/Hard 4K budget tests | `npm test` | Soft/hard budgets match<br>Transaction commit/rollback |
| **`SyncManager.js`** | • Master QA Suite (Tests 49, 64, 66)<br>• `scripts/ae-sync-camera-regression.js` | `node scripts/ae-sync-camera-regression.js`<br>`npm test` | Timeline sync lock<br>Bézier keyframes intact |
| **`vectorHost.jsx`** | • Master QA Suite (Tests 8–10, 27–30, 78)<br>• `scripts/verify-vector-geometry.js` | `node scripts/verify-vector-geometry.js`<br>`npm test` | Shape layers match<br>UndoGroup valid |
| **Host Modules (`host/*.jsx`)** | • Master QA Suite (Tests 14, 35, 41, 74)<br>• `scripts/verify-package.js` | `npm run verify:package`<br>`npm test` | ES3 syntax compliant<br>Zero global leaks |

---

## 2. Gate Verification Sequence (Run After Every Micro-Step)

Before committing any single refactored file, execute this 3-step verification chain:

```powershell
# Step 1: Run fast unit tests
npm test

# Step 2: Run specific regression suites
node scripts/tests/map/viewport-resize.test.js
node scripts/tests/map/pitch-3d.test.js

# Step 3: Run package integrity & syntax audit
npm run verify:package
```

---

## 3. Post-Refactoring Architectural Certification

Once all 5 phases of the roadmap are completed, execute the Master Quality Gate:

```powershell
# 1. Run all 10 Master QA Suites
node scripts/run-all-tests.js

# 2. Re-run the automated architectural auditor
node .agents/skills/opengeo-architect/scripts/architect-audit.js

# 3. Verify final release build
npm run verify:release
```

**Expected Exit Criteria:**
* 0 test failures across all 162 tests.
* 0 ExtendScript ES3 namespace warnings.
* 0 files with Responsibility Entropy > 3.
* Package checksum matches baseline manifest.
