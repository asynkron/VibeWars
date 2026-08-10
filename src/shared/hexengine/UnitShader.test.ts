import '../../test/threeStub';
import { describe, expect, it } from 'vitest';
import { applyDirtyPlateToModel } from './UnitShader';

describe('applyDirtyPlateToModel', () => {
    it('weathers painted surfaces but preserves cockpit and effects materials', () => {
        const armour: any = { name: 'armor', userData: {} };
        const canopy: any = { name: 'canopy_glass', userData: {} };
        const rotor: any = { name: 'rotor_blur', userData: {} };
        const mesh = { isMesh: true, material: [armour, canopy, rotor] };
        const root = { traverse: (visitor: (child: any) => void) => visitor(mesh) };

        applyDirtyPlateToModel(root);

        expect(armour.userData.dirtyPlate).toBe(true);
        expect(canopy.userData.dirtyPlate).toBeUndefined();
        expect(rotor.userData.dirtyPlate).toBeUndefined();
    });
});
