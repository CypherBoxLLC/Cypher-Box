// In-memory react-native-mmkv mock for jest. Registry keyed by store id so
// separate MMKV instances with the same id share data (as on device).
const stores = new Map();

class MMKV {
  constructor(configuration) {
    this.id = (configuration && configuration.id) || 'mmkv.default';
    if (!stores.has(this.id)) stores.set(this.id, new Map());
    this._data = stores.get(this.id);
  }

  getString(key) {
    return this._data.has(key) ? this._data.get(key) : undefined;
  }

  set(key, value) {
    this._data.set(key, value);
  }

  delete(key) {
    this._data.delete(key);
  }

  clearAll() {
    this._data.clear();
  }

  getAllKeys() {
    return [...this._data.keys()];
  }

  contains(key) {
    return this._data.has(key);
  }
}

MMKV.__stores = stores;

module.exports = { MMKV };
