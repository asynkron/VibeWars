import { describe, expect, it } from 'vitest';
import { scaleDamageByHealth } from './combatDamage';

describe('scaleDamageByHealth', () => {
    it('scales damage linearly with current health', () => {
        expect(scaleDamageByHealth(20, 100, 100)).toBe(20);
        expect(scaleDamageByHealth(20, 75, 100)).toBe(15);
        expect(scaleDamageByHealth(20, 50, 100)).toBe(10);
        expect(scaleDamageByHealth(20, 25, 100)).toBe(5);
    });

    it('rounds fractional damage to the nearest integer', () => {
        expect(scaleDamageByHealth(5, 50, 100)).toBe(3);
        expect(scaleDamageByHealth(5, 25, 100)).toBe(1);
    });

    it('keeps a positive hit at one damage while the attacker is alive', () => {
        expect(scaleDamageByHealth(1, 1, 100)).toBe(1);
    });

    it('does not let dead, invalid, or overhealed attackers distort damage', () => {
        expect(scaleDamageByHealth(10, 0, 100)).toBe(0);
        expect(scaleDamageByHealth(10, 50, 0)).toBe(0);
        expect(scaleDamageByHealth(10, 150, 100)).toBe(10);
    });
});
