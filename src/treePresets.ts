import type { DeciduousTreeParameters } from './shared/hexengine/ProceduralDecorations';
import {
    BIRCH_TREE_PARAMETERS,
    BROADLEAF_TREE_PARAMETERS,
    PINE_TREE_PARAMETERS,
    SPRUCE_TREE_PARAMETERS,
} from './shared/hexengine/treeModelPresets';

export interface TreePreset {
    id: string;
    name: string;
    variant: string;
    parameters: DeciduousTreeParameters;
    windStrength: number;
}

export const TREE_PRESETS: readonly TreePreset[] = [
    {
        id: 'broadleaf-standard',
        name: 'Lövträd · Standard',
        variant: 'Lövträd #05',
        windStrength: 1,
        parameters: BROADLEAF_TREE_PARAMETERS,
    },
    {
        id: 'spruce',
        name: 'Gran',
        variant: 'Gran #01',
        windStrength: 1,
        parameters: SPRUCE_TREE_PARAMETERS,
    },
    {
        id: 'pine',
        name: 'Tall',
        variant: 'Tall #01',
        windStrength: 1,
        parameters: PINE_TREE_PARAMETERS,
    },
    {
        id: 'birch',
        name: 'Björk',
        variant: 'Björk #01',
        windStrength: 1,
        parameters: BIRCH_TREE_PARAMETERS,
    },
];
