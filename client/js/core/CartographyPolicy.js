class CartographyPolicy {
  constructor(repository, options = {}) {
    this.repository = repository || null;
    this.data = options.data || this._loadRuntimePolicy();
    this.valid = this._isValid(this.data);
    if (!this.valid) {
      this.data = {
        policyId: 'opengeo-cartography-policy',
        policyVersion: 'unknown',
        dataBundleVersion: 'unknown',
        activeProfiles: [],
        sourcePolicySha256: null
      };
    }
  }

  _loadRuntimePolicy() {
    if (!this.repository || typeof this.repository.loadDataset !== 'function') return null;
    return this.repository.loadDataset('vectors/cartography-policy.json');
  }

  _isValid(value) {
    return !!(value && value.schemaVersion === '1.0.0' && value.policyId && value.policyVersion &&
      value.dataBundleVersion && Array.isArray(value.activeProfiles));
  }

  getMetadataStamp() {
    return Object.freeze({
      policyId: this.data.policyId,
      policyVersion: this.data.policyVersion,
      dataBundleVersion: this.data.dataBundleVersion,
      activeProfileIds: Object.freeze(this.data.activeProfiles
        .filter(profile => profile && profile.status === 'active-locked')
        .map(profile => profile.profileId)),
      sourcePolicySha256: this.data.sourcePolicySha256 || null
    });
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = CartographyPolicy;
else if (typeof window !== 'undefined') window.CartographyPolicy = CartographyPolicy;
