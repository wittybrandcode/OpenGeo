var OpenGeoConfig = {
  version: '1.0.0',

  tileSources: {
    esri: {
      name: 'Satellite — ESRI World Imagery',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      maxZoom: 18,
      minZoom: 2,
      attribution: 'ESRI, Maxar, Earthstar Geographics',
      attributionUrl: 'https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9',
      format: 'jpg'
    },
    mapboxSatellite: {
      name: 'Satellite — Mapbox (requires API key)',
      url: 'https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token={key}',
      maxZoom: 22,
      minZoom: 2,
      requiresKey: true,
      attribution: 'Mapbox, Maxar',
      attributionUrl: 'https://www.mapbox.com/about/maps/',
      format: 'jpg',
      tileSize: 512
    },
    maptiler: {
      name: 'Satellite — MapTiler (requires API key)',
      url: 'https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key={key}',
      maxZoom: 20,
      minZoom: 1,
      requiresKey: true,
      attribution: 'MapTiler, Maxar',
      attributionUrl: 'https://www.maptiler.com/copyright/',
      format: 'jpg',
      tileSize: 512
    },
    satellite2025: {
      name: 'Satellite — Sentinel-2 2025',
      url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',
      maxZoom: 14,
      minZoom: 2,
      attribution: 'Sentinel-2 cloudless 2025 by EOX (modified Copernicus Sentinel data)',
      attributionUrl: 'https://s2maps.eu/',
      format: 'jpg'
    },
    satellite2024: {
      name: 'Satellite — Sentinel-2 2024',
      url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',
      maxZoom: 14,
      minZoom: 2,
      attribution: 'Sentinel-2 cloudless 2024 by EOX (modified Copernicus Sentinel data)',
      attributionUrl: 'https://s2maps.eu/',
      format: 'jpg'
    },
    osm: {
      name: 'Street — OpenStreetMap',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      maxZoom: 19,
      minZoom: 1,
      attribution: 'OpenStreetMap contributors',
      attributionUrl: 'https://www.openstreetmap.org/copyright',
      format: 'png'
    },
    cartoDark: {
      name: 'Vector Dark — CartoDB Dark Matter',
      url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      maxZoom: 19,
      minZoom: 1,
      attribution: 'CartoDB, OpenStreetMap',
      attributionUrl: 'https://carto.com/attributions',
      format: 'png'
    },
    cartoLight: {
      name: 'Vector Light — CartoDB Positron',
      url: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
      maxZoom: 19,
      minZoom: 1,
      attribution: 'CartoDB, OpenStreetMap',
      attributionUrl: 'https://carto.com/attributions',
      format: 'png'
    },
    stamenTerrain: {
      name: 'Topographic — Stamen / Stadia Terrain',
      url: 'https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.png?api_key={key}',
      maxZoom: 18,
      minZoom: 1,
      requiresKey: true,
      attribution: 'Stadia Maps, Stamen Design, OpenStreetMap',
      attributionUrl: 'https://stadiamaps.com/',
      format: 'png'
    }
  },



  defaults: {
    tileSource: 'esri',
    tileSize: 256,
    centerLat: 0,
    centerLng: 0,
    zoom: 2,
    defaultBounds: [-80, 80, -180, 180], // World bounds
    maxZoom: 14,
    minZoom: 2,
    cacheMemoryLimit: 300,
    cacheDiskLimit: 1000,
    downloadConcurrency: 4,
    downloadRetries: 1,
    downloadTimeout: 15000,
    panelWidth: 300,
    panelHeight: 500
  },

};
