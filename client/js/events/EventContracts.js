/** Central event catalog. Every cross-module EventBus name must exist here. */
const OpenGeoEvents = Object.freeze({
  VIEWPORT_CHANGED: 'viewport:changed',
  CAMERA_INTENT: 'camera:intent',
  SYNC_COMP_CHANGED: 'sync:compChanged',
  SYNC_AE_CAMERA: 'sync:aeCamera',
  SYNC_HEALTH: 'sync:health',
  UI_STATUS: 'ui:status',
  UI_DOWNLOAD_MODAL: 'ui:download_modal',
  TOAST_SHOW: 'toast:show',
  TILES_LOADED: 'tiles:loaded',
  TILES_ERROR: 'tiles:error',
  TILES_ALL_LOADED: 'tiles:allLoaded',
  TILES_RENDER_READY: 'tiles:renderReady',
  OVERLAY_CHANGED: 'overlay:changed',
  MARKER_ADD: 'marker:add',
  MARKER_CLEAR: 'marker:clear',
  GEOJSON_LOAD: 'geojson:load',
  GEOJSON_CLEAR: 'geojson:clear',
  PROVIDERS_UPDATED: 'providers:updated',
  SETTINGS_SOURCE_CHANGED: 'settings:sourceChanged',
  SETTINGS_TILE_SIZE_CHANGED: 'settings:tileSizeChanged',
  SETTINGS_THEME_CHANGED: 'settings:themeChanged',
  SEARCH_DRAW_COUNTRY_OUTLINE: 'search:drawCountryOutline',
  STITCH_PROGRESS: 'stitch:progress',
  STITCH_COMPLETE: 'stitch:complete',
  OPERATION_PROGRESS: 'operation:progress',
  OPERATION_RESULT: 'operation:result',
  ERROR_REPORT: 'error:report',
  PROJECT_MAPS_THUMBNAIL_UPDATED: 'project-maps:thumbnail-updated',
  FINALIZE_STATE_CHANGE: 'finalize:stateChange',
  SYNC_STATE_CHANGE: 'sync:stateChange'
});

const isObject = value => !!value && typeof value === 'object';
const isMessage = value => isObject(value) && typeof value.message === 'string';
const isCamera = value => isObject(value) && Number.isFinite(value.lat) && Number.isFinite(value.lng) && Number.isFinite(value.zoom);
const anyPayload = () => true;

const OpenGeoEventCatalog = Object.freeze({
  'viewport:changed': { owner: 'Viewport', mode: 'sync', publishers: ['Viewport'], subscribers: ['App', 'AESyncEngine'], validate: isCamera },
  'camera:intent': { owner: 'MapSession', mode: 'sync', publishers: ['InputController'], subscribers: ['MapSession'], validate: isCamera },
  'sync:compChanged': { owner: 'AESyncEngine', mode: 'async-listeners', publishers: ['AESyncEngine'], subscribers: ['App'], validate: value => isObject(value) && value.newId !== undefined },
  'sync:aeCamera': { owner: 'AESyncEngine', mode: 'sync', publishers: ['AESyncEngine'], subscribers: ['App'], validate: isCamera },
  'sync:health': { owner: 'AESyncEngine', mode: 'sync', publishers: ['AESyncEngine'], subscribers: ['Diagnostics'], validate: isObject },
  'ui:status': { owner: 'OperationPresenter', mode: 'sync', publishers: ['Application'], subscribers: ['App'], validate: isMessage },
  'ui:download_modal': { owner: 'OperationPresenter', mode: 'sync', publishers: ['FinalizeController', 'SyncManager'], subscribers: ['App'], validate: value => isObject(value) && typeof value.show === 'boolean' },
  'toast:show': { owner: 'OperationPresenter', mode: 'sync', publishers: ['Application'], subscribers: ['Toast'], validate: isMessage },
  'tiles:loaded': { owner: 'TileDownloader', mode: 'sync', publishers: ['TileDownloader'], subscribers: ['TileManager'], validate: value => isObject(value) && typeof value.key === 'string' },
  'tiles:error': { owner: 'TileDownloader', mode: 'sync', publishers: ['TileDownloader'], subscribers: ['TileManager'], validate: value => isObject(value) && typeof value.key === 'string' },
  'tiles:allLoaded': { owner: 'TileDownloader', mode: 'sync', publishers: ['TileDownloader'], subscribers: [], validate: anyPayload },
  'tiles:renderReady': { owner: 'TileManager', mode: 'sync', publishers: ['TileManager'], subscribers: ['App'], validate: value => Array.isArray(value) },
  'overlay:changed': { owner: 'Overlay', mode: 'sync', publishers: ['Overlay', 'TileManager'], subscribers: ['App'], validate: anyPayload },
  'marker:add': { owner: 'MarkerLayer', mode: 'sync', publishers: ['SearchPanel', 'InputHandler'], subscribers: ['MarkerLayer'], validate: value => isObject(value) && Number.isFinite(value.lat) && Number.isFinite(value.lng) },
  'marker:clear': { owner: 'MarkerLayer', mode: 'sync', publishers: ['App'], subscribers: ['MarkerLayer'], validate: anyPayload },
  'geojson:load': { owner: 'GeoJSONLayer', mode: 'sync', publishers: ['GeoJSONController'], subscribers: ['GeoJSONLayer'], validate: value => typeof value === 'string' || isObject(value) },
  'geojson:clear': { owner: 'GeoJSONLayer', mode: 'sync', publishers: ['App'], subscribers: ['GeoJSONLayer'], validate: anyPayload },
  'providers:updated': { owner: 'ProviderManager', mode: 'sync', publishers: ['ProviderManager'], subscribers: ['App'], validate: anyPayload },
  'settings:sourceChanged': { owner: 'SettingsPanel', mode: 'sync', publishers: ['SettingsPanel'], subscribers: ['App'], validate: value => typeof value === 'string' && !!value },
  'settings:tileSizeChanged': { owner: 'SettingsPanel', mode: 'sync', publishers: ['SettingsPanel'], subscribers: ['App'], validate: value => value === 256 || value === 512 },
  'settings:themeChanged': { owner: 'SettingsPanel', mode: 'sync', publishers: ['SettingsPanel'], subscribers: ['App'], validate: value => typeof value === 'string' },
  'search:drawCountryOutline': { owner: 'SearchPanel', mode: 'async-listeners', publishers: ['SearchPanel'], subscribers: ['VectorMapManager'], validate: value => isObject(value) && typeof value.countryCode === 'string' },
  'stitch:progress': { owner: 'MegaTileStitcher', mode: 'sync', publishers: ['MegaTileStitcher'], subscribers: ['App'], validate: isObject },
  'stitch:complete': { owner: 'MegaTileStitcher', mode: 'sync', publishers: ['MegaTileStitcher'], subscribers: ['App'], validate: isObject },
  'operation:progress': { owner: 'OperationManager', mode: 'sync', publishers: ['LongRunningOperation'], subscribers: ['OperationPresenter', 'OperationLogger'], validate: value => isObject(value) && typeof value.operationId === 'string' && typeof value.phase === 'string' },
  'operation:result': { owner: 'OperationManager', mode: 'sync', publishers: ['LongRunningOperation'], subscribers: ['OperationPresenter', 'OperationLogger'], validate: value => isObject(value) && typeof value.operationId === 'string' && typeof value.ok === 'boolean' },
  'error:report': { owner: 'ErrorBoundary', mode: 'sync', publishers: ['Application'], subscribers: ['OperationLogger'], validate: value => isObject(value) && typeof value.code === 'string' },
  'project-maps:thumbnail-updated': { owner: 'FinalizeController', mode: 'sync', publishers: ['FinalizeController'], subscribers: ['ProjectMapsPanel'], validate: value => isObject(value) && typeof value.documentId === 'string' },
  'finalize:stateChange': { owner: 'FinalizeController', mode: 'sync', publishers: ['FinalizeController'], subscribers: [], validate: anyPayload },
  'sync:stateChange': { owner: 'SyncManager', mode: 'sync', publishers: ['SyncManager'], subscribers: [], validate: anyPayload }
});

const OpenGeoEventContracts = {
  events: OpenGeoEvents,
  catalog: OpenGeoEventCatalog,

  isKnown(event) {
    return Object.prototype.hasOwnProperty.call(OpenGeoEventCatalog, event);
  },

  get(event) {
    return OpenGeoEventCatalog[event] || null;
  },

  isValid(event, payload) {
    const definition = this.get(event);
    return !!definition && definition.validate(payload);
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = OpenGeoEventContracts;
else if (typeof window !== 'undefined') {
  window.OpenGeoEvents = OpenGeoEvents;
  window.OpenGeoEventCatalog = OpenGeoEventCatalog;
  window.OpenGeoEventContracts = OpenGeoEventContracts;
}
