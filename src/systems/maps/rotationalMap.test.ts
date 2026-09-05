import { describe, expect, it } from 'vitest';
import { crown14MapProvider } from './Crown14MapProvider';
import { ford10MapProvider } from './Ford10MapProvider';
import { rotor12x18MapProvider } from './Rotor12x18MapProvider';

// Captured before consolidating the generators. Includes every tile property,
// exact floating-point heights, road flags, building piece and starting unit.
const fixtures = [
    [crown14MapProvider, '4f92ca41'],
    [ford10MapProvider, 'd001cea4'],
    [rotor12x18MapProvider, '35e301b'],
] as const;

describe('authored map compatibility', () => {
    it.each(fixtures)('%s preserves its complete authored board', (provider, expected) => {
        const data = JSON.stringify([provider.generate(), provider.spawns, provider.buildings]);
        let hash = 0x811c9dc5;
        for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data.charCodeAt(i), 0x01000193);
        expect((hash >>> 0).toString(16)).toBe(expected);
    });
});
