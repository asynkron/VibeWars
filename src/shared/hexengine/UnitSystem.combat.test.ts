import '../../test/threeStub';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnitSystem } from './UnitSystem';

function unit(patch: Record<string, unknown> = {}) {
    return {
        type: 'Bulwark', q: 1, r: 1, playerIndex: 0, hp: 10, maxHp: 10,
        ...patch,
    } as any;
}

describe('UnitSystem.resolveLiveAttack health scaling', () => {
    afterEach(() => vi.restoreAllMocks());

    it('uses the live random roll, then scales the final hit by attacker health', () => {
        // Bulwark's 4..6 roll is 5 at 0.5. Half health turns that into 3.
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        const attacker = unit({ hp: 5, maxHp: 10 });
        const defender = unit({ type: 'Pike', playerIndex: 1 });

        const outcome = UnitSystem.resolveLiveAttack(
            attacker,
            defender,
            UnitSystem.unitTypesRecord.Bulwark,
        );

        expect(outcome.damages).toEqual([{ unit: defender, damage: 3 }]);
    });

    it('preserves the old live damage at full health', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        const attacker = unit();
        const defender = unit({ type: 'Pike', playerIndex: 1 });

        const outcome = UnitSystem.resolveLiveAttack(
            attacker,
            defender,
            UnitSystem.unitTypesRecord.Bulwark,
        );

        expect(outcome.damages).toEqual([{ unit: defender, damage: 5 }]);
    });
});
