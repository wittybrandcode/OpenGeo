class GeographyIdentityResolver {
  constructor(repository, options = {}) {
    this.repository = repository || null;
    this.countryIndex = options.countryIndex || this._loadDataset('vectors/country-index-10m.json') || {};
    this.registry = options.aliasRegistry || this._loadDataset('geography/identity-aliases.json') || {};
    this.countries = this.countryIndex.countries || {};
    this.iso2ToIso3 = this.countryIndex.iso2ToIso3 || {};
    this._countryAliases = new Map();
    this._overrideAliases = new Map();
    this._relationIdentities = new Map();
    this._buildLookups();
  }

  _loadDataset(filename) {
    if (!this.repository || typeof this.repository.loadDataset !== 'function') return null;
    return this.repository.loadDataset(filename);
  }

  _normalize(value) {
    return String(value || '')
      .normalize('NFKC')
      .trim()
      .toLocaleLowerCase()
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ');
  }

  _buildLookups() {
    Object.keys(this.countries).sort().forEach(iso3 => {
      const country = this.countries[iso3] || {};
      [iso3, country.iso2, country.name, country.nameLong, country.nameAr].forEach(alias => {
        const normalized = this._normalize(alias);
        if (!normalized || this._countryAliases.has(normalized)) return;
        this._countryAliases.set(normalized, iso3);
      });
    });

    const overrides = this.registry.identityOverrides || {};
    Object.keys(overrides).sort().forEach(iso3 => {
      const definition = overrides[iso3] || {};
      (definition.aliases || []).forEach(alias => {
        const normalized = this._normalize(alias);
        if (normalized) this._overrideAliases.set(normalized, iso3);
      });
    });

    const relations = this.registry.osmRelations || {};
    Object.keys(relations).forEach(key => {
      const iso3 = String(relations[key] || '').toUpperCase();
      if (this.countries[iso3]) this._relationIdentities.set(this._normalize(key), iso3);
    });
  }

  _resolveCode(code) {
    const normalized = String(code || '').trim().toUpperCase();
    if (!normalized) return null;
    if (this.countries[normalized]) return normalized;
    const mapped = this.iso2ToIso3[normalized];
    return mapped && this.countries[mapped] ? mapped : null;
  }

  _resolveExactAlias(value, overridesOnly) {
    const normalized = this._normalize(value);
    if (!normalized) return null;
    return this._overrideAliases.get(normalized) || (overridesOnly ? null : this._countryAliases.get(normalized)) || null;
  }

  _resolveContainedOverride(value) {
    const normalized = this._normalize(value);
    if (!normalized) return null;
    for (const [alias, iso3] of this._overrideAliases.entries()) {
      if (normalized === alias || normalized.indexOf(alias) !== -1) return iso3;
    }
    return null;
  }

  _resolveHierarchyOverride(value) {
    const parts = String(value || '').split(/[,،]/);
    for (const part of parts) {
      const iso3 = this._resolveExactAlias(part, true);
      if (iso3) return iso3;
    }
    return null;
  }

  _getStructuredIdentity(item) {
    const address = item.address || {};
    const structuredNames = [
      item.name,
      address.country,
      address.state,
      address.region,
      address.county
    ];
    for (const value of structuredNames) {
      const iso3 = this._resolveExactAlias(value, true);
      if (iso3) return { iso3, ruleId: 'identity.structured.override-alias', confidence: 0.98 };
    }

    const tags = item.extratags || {};
    const explicitCode = tags['ISO3166-1:alpha3'] || tags['ISO3166-1:alpha2'] || tags['ISO3166-1'];
    const taggedIso3 = this._resolveCode(explicitCode);
    if (taggedIso3) return { iso3: taggedIso3, ruleId: 'identity.structured.iso-tag', confidence: 0.99 };

    const providerIso3 = this._resolveCode(address.country_code);
    if (providerIso3) return { iso3: providerIso3, ruleId: 'identity.structured.country-code', confidence: 0.94 };

    for (const value of structuredNames) {
      const iso3 = this._resolveExactAlias(value, false);
      if (iso3) return { iso3, ruleId: 'identity.structured.country-alias', confidence: 0.92 };
    }
    return null;
  }

  _getSourceAttribution(item) {
    const address = item.address || {};
    return Object.freeze({
      provider: 'nominatim',
      displayName: String(item.display_name || ''),
      countryCode: String(address.country_code || '').toUpperCase() || null,
      osmType: item.osm_type ? String(item.osm_type).toLowerCase() : null,
      osmId: item.osm_id === undefined || item.osm_id === null ? null : String(item.osm_id)
    });
  }

  _getDisplayLabel(item, iso3) {
    const rawLabel = String(item.display_name || item.name || '').trim();
    if (!rawLabel || !iso3) return rawLabel;
    const definition = (this.registry.identityOverrides || {})[iso3];
    if (!definition || !Array.isArray(definition.stripHierarchyAliases)) return rawLabel;
    const blocked = new Set(definition.stripHierarchyAliases.map(value => this._normalize(value)));
    const parts = rawLabel
      .split(/[,،]/)
      .map(part => part.trim())
      .filter(part => part && !blocked.has(this._normalize(part)));
    const localCountry = this.countries[iso3] || {};
    return parts.join(', ') || localCountry.nameLong || localCountry.name || rawLabel;
  }

  resolve(rawItem, query) {
    const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
    let decision = null;
    const relationKey = item.osm_type && item.osm_id !== undefined && item.osm_id !== null
      ? this._normalize(`${item.osm_type}:${item.osm_id}`) : '';
    const relationIso3 = relationKey ? this._relationIdentities.get(relationKey) : null;
    if (relationIso3) {
      decision = { iso3: relationIso3, ruleId: 'identity.osm-relation', confidence: 1 };
    }

    if (!decision) {
      const address = item.address || {};
      const structuredOverrideNames = [item.name, address.country, address.state, address.region, address.county];
      for (const value of structuredOverrideNames) {
        const iso3 = this._resolveExactAlias(value, true);
        if (!iso3) continue;
        decision = { iso3, ruleId: 'identity.structured.override-alias', confidence: 0.98 };
        break;
      }
    }

    // Some providers deliberately use a different administrative country_code
    // for disputed places. An exact country alias in one hierarchy segment is
    // stronger than that attribution; arbitrary substring matches are not.
    if (!decision) {
      const displayIso3 = this._resolveHierarchyOverride(item.display_name);
      if (displayIso3) decision = { iso3: displayIso3, ruleId: 'identity.display.hierarchy-alias', confidence: 0.88 };
    }

    if (!decision) decision = this._getStructuredIdentity(item);

    if (!decision) {
      const queryIso3 = this._resolveExactAlias(query, false);
      if (queryIso3) decision = { iso3: queryIso3, ruleId: 'identity.query.exact-alias', confidence: 0.84 };
    }

    if (!decision) {
      const fallbackIso3 = this._resolveContainedOverride(`${query || ''} ${item.display_name || ''}`);
      if (fallbackIso3) decision = { iso3: fallbackIso3, ruleId: 'identity.text.fallback', confidence: 0.58 };
    }

    const drawingIso3 = decision ? decision.iso3 : 'UNKNOWN';
    return Object.freeze({
      drawingIso3,
      displayLabel: this._getDisplayLabel(item, decision && decision.iso3),
      sourceAttribution: this._getSourceAttribution(item),
      confidence: decision ? decision.confidence : 0,
      ruleId: decision ? decision.ruleId : 'identity.unknown'
    });
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = GeographyIdentityResolver;
else if (typeof window !== 'undefined') window.GeographyIdentityResolver = GeographyIdentityResolver;
