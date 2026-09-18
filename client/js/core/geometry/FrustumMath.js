/**
 * OpenGeo — FrustumMath (Functional Core)
 *
 * Pure mathematical functions for 3D perspective camera projection,
 * horizon calculation, and tile overscan bounds.
 * Zero dependencies on DOM, Window, Canvas, or After Effects runtime.
 * Deterministic, idempotent, and 100% headless testable.
 */

class FrustumMath {
  /**
   * Converts degrees to radians.
   * @param {number} deg
   * @returns {number}
   */
  static degToRad(deg) {
    return (Number(deg) || 0) * Math.PI / 180;
  }

  /**
   * Converts radians to degrees.
   * @param {number} rad
   * @returns {number}
   */
  static radToDeg(rad) {
    return (Number(rad) || 0) * 180 / Math.PI;
  }

  /**
   * Clamps camera pitch angle to safe perspective limits [0, maxPitch].
   * @param {number} pitch
   * @param {number} [maxPitch=45]
   * @returns {number}
   */
  static clampPitch(pitch, maxPitch = 45) {
    const p = Number(pitch) || 0;
    return Math.max(0, Math.min(maxPitch, p));
  }

  /**
   * Normalizes camera bearing angle to [0, 360) degrees.
   * @param {number} bearing
   * @returns {number}
   */
  static normalizeBearing(bearing) {
    return ((((Number(bearing) || 0) % 360) + 360) % 360);
  }

  /**
   * Computes 3D horizon and boundary overscan gutters.
   * When tilted (pitch > 0), expands gutter to 3 to prevent black void seams.
   * When flat (pitch === 0), maintains bounded gutter = 1.
   * @param {number} pitch
   * @returns {{gutterX: number, gutterY: number, horizonGutter: number}}
   */
  static calculatePitchOverscan(pitch) {
    const is3D = (Number(pitch) || 0) > 0;
    return {
      gutterX: is3D ? 3 : 1,
      gutterY: is3D ? 3 : 1,
      horizonGutter: is3D ? 3 : 0
    };
  }

  /**
   * Computes foreshortening scale factor at normalized screen Y coordinate [0..1].
   * Near bottom (y=1) -> scale near 1.0; near top (y=0) -> compressed by cos(pitch).
   * @param {number} pitch
   * @param {number} normalizedY 0 = top of screen, 1 = bottom of screen
   * @returns {number} Scale factor
   */
  static calculatePerspectiveScale(pitch, normalizedY) {
    const p = this.clampPitch(pitch);
    if (p === 0) return 1.0;
    const rad = this.degToRad(p);
    const cosP = Math.cos(rad);
    // Linear perspective interpolation along viewing frustum
    const ny = Math.max(0, Math.min(1, Number(normalizedY) || 0));
    return cosP + (1.0 - cosP) * ny;
  }

  /**
   * Calculates atmospheric horizon fade range in pixels from top of viewport.
   * @param {number} pitch
   * @param {number} viewportHeight
   * @returns {{fadeStart: number, fadeEnd: number, isActive: boolean}}
   */
  static calculateHorizonFadeRange(pitch, viewportHeight) {
    const p = this.clampPitch(pitch);
    if (p === 0 || !viewportHeight) {
      return { fadeStart: 0, fadeEnd: 0, isActive: false };
    }
    const h = Number(viewportHeight) || 0;
    // Fade occupies top 15% - 25% of the viewport at max pitch
    const ratio = (p / 45) * 0.25;
    return {
      fadeStart: 0,
      fadeEnd: Math.round(h * ratio),
      isActive: true
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FrustumMath;
}
if (typeof window !== 'undefined') {
  window.FrustumMath = FrustumMath;
}
