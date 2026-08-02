// Shared axial hex coordinate helper.
class HexCoord {
  constructor(q, r) {
    this.q = q;
    this.r = r;
  }

  static fromKey(key) {
    const [q, r] = key.split(',').map(Number);
    return new HexCoord(q, r);
  }

  static isWithinMapBounds(q, r) {
    return q >= 0 && q < MAP_CONFIG.COLS && r >= 0 && r < MAP_CONFIG.ROWS;
  }

  static findHex(q, r) {
    return GridSystem.findHex(q, r);
  }

  static getHexPosition(q, r) {
    const x = MAP_CONFIG.HEX_RADIUS * 1.5 * q;
    const z = MAP_CONFIG.HEX_RADIUS * Math.sqrt(3) * (r + (q % 2) / 2);
    return { x, z };
  }

  static getNeighbors(q, r) {
    const isOddColumn = q % 2 === 1;
    return [
      { q: q - 1, r: r - (isOddColumn ? 0 : 1) },
      { q: q, r: r - 1 },
      { q: q + 1, r: r - (isOddColumn ? 0 : 1) },
      { q: q + 1, r: r + 1 - (isOddColumn ? 0 : 1) },
      { q: q, r: r + 1 },
      { q: q - 1, r: r + 1 - (isOddColumn ? 0 : 1) },
    ];
  }

  static getDistance(q1, r1, q2, r2) {
    return Math.max(Math.abs(q1 - q2), Math.abs(r1 - r2), Math.abs(q1 + r1 - (q2 + r2)));
  }

  static getWorldPositionFromCoords(q, r, height = 0) {
    const pos = HexCoord.getHexPosition(q, r);
    return new THREE.Vector3(pos.x, height, pos.z);
  }

  getKey() {
    return `${this.q},${this.r}`;
  }

  getHex() {
    return HexCoord.findHex(this.q, this.r);
  }

  isValid() {
    return HexCoord.isWithinMapBounds(this.q, this.r);
  }

  getNeighbors() {
    return HexCoord.getNeighbors(this.q, this.r).map((n) => new HexCoord(n.q, n.r));
  }

  getValidNeighbors(visited = new Set()) {
    return this.getNeighbors()
      .filter((n) => n.isValid() && !visited.has(n.getKey()))
      .map((n) => ({ coord: n, hex: n.getHex() }))
      .filter((n) => n.hex !== undefined);
  }

  distanceTo(other) {
    return HexCoord.getDistance(this.q, this.r, other.q, other.r);
  }

  getWorldPosition(height = 0) {
    const pos = HexCoord.getHexPosition(this.q, this.r);
    return new THREE.Vector3(pos.x, height, pos.z);
  }

  isOccupied(excludeUnit = null) {
    const engine = typeof window !== 'undefined' ? window.HEX_ENGINE : null;
    if (engine?.getOption && engine.getOption('enableUnitSystems') && typeof UnitSystem !== 'undefined') {
      return UnitSystem.isHexOccupied(this.q, this.r, excludeUnit);
    }
    return false;
  }
}

if (typeof window !== 'undefined') {
  window.HexCoord = HexCoord;
}
