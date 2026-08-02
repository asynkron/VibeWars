(function () {
  const DEFAULT_OPTIONS = {
    loadModels: true,
    enableDecorations: true,
    enableUnitSystems: true,
    enableRoads: true,
  };

  const userOptions = (typeof window !== 'undefined' && window.HEX_ENGINE_OPTIONS) || {};
  const merged = { ...DEFAULT_OPTIONS, ...userOptions };

  const api = {
    options: merged,
    getOption(key) {
      if (Object.prototype.hasOwnProperty.call(this.options, key)) {
        return this.options[key];
      }
      return undefined;
    },
    setOption(key, value) {
      this.options[key] = value;
    },
  };

  if (typeof window !== 'undefined') {
    window.HEX_ENGINE = api;
  }
})();
