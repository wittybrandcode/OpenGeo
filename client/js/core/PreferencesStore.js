class PreferencesStore {
  constructor(storage, key, config, contracts, migrations) {
    this.storage = storage;
    this.key = key || 'opengeo_prefs';
    this.config = config;
    this.contracts = contracts;
    this.migrations = migrations || (typeof OpenGeoVersionMigrations !== 'undefined' ? OpenGeoVersionMigrations : null);
  }

  load() {
    let parsed = {};
    try { parsed = JSON.parse(this.storage.getItem(this.key) || '{}'); }
    catch (ignoreParse) { parsed = {}; }

    if (this.migrations) {
      const migration = this.migrations.migratePreferences(parsed, this.config.defaults, this.config.version);
      parsed = migration.value;
      if (migration.migrated && !migration.future) this.saveRaw(parsed);
    } else if (parsed.version !== this.config.version) {
      parsed = Object.assign({}, parsed, { version: this.config.version, isNewVersion: Object.keys(parsed).length === 0 });
      this.saveRaw(parsed);
    }
    return this.contracts.fromPreferences(parsed, this.config.defaults);
  }

  saveSession(session) {
    const prefs = this.contracts.toPreferences(session.snapshot(), this.config.version);
    prefs.schemaVersion = this.migrations ? this.migrations.versions.settingsSchema : '1.0.0';
    this.saveRaw(prefs);
    return prefs;
  }

  saveRaw(value) {
    try { this.storage.setItem(this.key, JSON.stringify(value)); }
    catch (ignoreStorage) { /* localStorage quota or access denied fallback */ }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PreferencesStore;
} else if (typeof window !== 'undefined') {
  window.PreferencesStore = PreferencesStore;
}
