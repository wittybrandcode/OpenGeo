/**
 * SpatialPin — Engine for Georeferenced 3D Markers in After Effects.
 * Generates AE expressions to stick Null layers to exact GPS coordinates
 * relative to the Map Controller rig.
 */
class SpatialPin {
  constructor(aeBridge) {
    this.aeBridge = aeBridge;
  }

  /**
   * Adds a spatial pin (Null layer) at the given GPS coordinates in AE with attached components and styling.
   * 
   * @param {string|number} compId 
   * @param {number} lat 
   * @param {number} lng 
   * @param {string} name 
   * @param {Object} [options] 
   */
  async addPin(compId, lat, lng, name = "Map Pin", options = {}) {
    try {
      return await this.aeBridge.invoke('pin.add', { compId, lat, lng, name, ...options });
    } catch (e) {
      console.error('Failed to add spatial pin', e);
      throw e;
    }
  }

}
