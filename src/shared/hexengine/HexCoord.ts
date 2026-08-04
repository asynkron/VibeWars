// Shared axial hex coordinate helper.
import { GridSystem } from './GridSystem';
import { UnitSystem } from './UnitSystem';
import { MAP_CONFIG } from '../../constants';
import { hexNeighbors, hexToCube, hexDistance } from './hexMath';

class HexCoord {
  q: number;
  r: number;

  constructor(q: number, r: number) {
    this.q = q;
    this.r = r;
  }

  static fromKey(key: string): HexCoord {
    const [q, r] = key.split(',').map(Number);
    return new HexCoord(q, r);
  }

  static isWithinMapBounds(q: number, r: number): boolean {
    return q >= 0 && q < MAP_CONFIG.COLS && r >= 0 && r < MAP_CONFIG.ROWS;
  }

  static findHex(q: number, r: number) {
    return GridSystem.findHex(q, r);
  }

  static getHexPosition(q: number, r: number): { x: number; z: number } {
    const x = MAP_CONFIG.HEX_RADIUS * 1.5 * q;
    const z = MAP_CONFIG.HEX_RADIUS * Math.sqrt(3) * (r + (q % 2) / 2);
    return { x, z };
  }

  // Delegated to hexMath, which imports nothing that renders -- see there.
  static getNeighbors(q: number, r: number): { q: number; r: number }[] {
    return hexNeighbors(q, r);
  }

  // q/r are "odd-q" offset coordinates (odd columns shifted down half a
  // row -- see getNeighbors' isOddColumn branching and getHexPosition's
  // `r + (q % 2) / 2`). Cube/axial distance formulas only apply after
  // converting to cube coordinates first; applying them directly to offset
  // (q, r) undercounts distance across a column-shift boundary. See
  // https://www.redblobgames.com/grids/hexagons/#conversions-offset for the
  // conversion this mirrors.
  private static toCube(q: number, r: number): { x: number; y: number; z: number } {
    return hexToCube(q, r);
  }

  static getDistance(q1: number, r1: number, q2: number, r2: number): number {
    return hexDistance(q1, r1, q2, r2);
  }

  static getWorldPositionFromCoords(q: number, r: number, height: number = 0) {
    const pos = HexCoord.getHexPosition(q, r);
    return new THREE.Vector3(pos.x, height, pos.z);
  }

  getKey(): string {
    return `${this.q},${this.r}`;
  }

  getHex() {
    return HexCoord.findHex(this.q, this.r);
  }

  isValid(): boolean {
    return HexCoord.isWithinMapBounds(this.q, this.r);
  }

  getNeighbors(): HexCoord[] {
    return HexCoord.getNeighbors(this.q, this.r).map((n) => new HexCoord(n.q, n.r));
  }

  getValidNeighbors(visited: Set<string> = new Set()) {
    return this.getNeighbors()
      .filter((n) => n.isValid() && !visited.has(n.getKey()))
      .map((n) => ({ coord: n, hex: n.getHex() }))
      .filter((n) => n.hex !== undefined);
  }

  distanceTo(other: HexCoord): number {
    return HexCoord.getDistance(this.q, this.r, other.q, other.r);
  }

  getWorldPosition(height: number = 0) {
    const pos = HexCoord.getHexPosition(this.q, this.r);
    return new THREE.Vector3(pos.x, height, pos.z);
  }

  isOccupied(excludeUnit: any = null): boolean {
    const engine = typeof window !== 'undefined' ? window.HEX_ENGINE : null;
    if (engine?.getOption && engine.getOption('enableUnitSystems') && typeof UnitSystem !== 'undefined') {
      return UnitSystem.isHexOccupied(this.q, this.r, excludeUnit);
    }
    return false;
  }
}

export { HexCoord };
