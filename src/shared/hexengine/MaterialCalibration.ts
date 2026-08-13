export type MaterialCalibrationTarget = 'water' | 'grass' | 'forest' | 'beach';

export interface MaterialCalibration {
    exposure: number;
    contrast: number;
    saturation: number;
    gamma: number;
    balance: [number, number, number];
}

const values: Record<MaterialCalibrationTarget, MaterialCalibration> = {
    // Calibrated against the fixed View 1 reference using identical material
    // rectangles downsampled into 4x4 average-colour blocks before scoring.
    water: {
        exposure: 0.82,
        contrast: 1,
        saturation: 0.93,
        gamma: 1,
        balance: [0.92, 1.12, 0.94],
    },
    grass: {
        exposure: 0.84,
        contrast: 1.05,
        saturation: 0.780703125,
        gamma: 1.1275,
        balance: [1.0315625, 0.9, 1.0859375],
    },
    forest: {
        exposure: 0.935,
        contrast: 1.03,
        saturation: 0.512734375,
        gamma: 1.095625,
        balance: [1.18375, 0.9775, 1.1496875],
    },
    beach: {
        exposure: 0.62,
        contrast: 0.89,
        saturation: 1.188671875,
        gamma: 1.015,
        balance: [1.0215625, 0.930625, 0.870625],
    },
};

export const MATERIAL_CALIBRATION_UNIFORMS = Object.fromEntries(
    Object.entries(values).map(([target, value]) => [target, {
        parameters: { value: new THREE.Vector4(
            value.exposure,
            value.contrast,
            value.saturation,
            value.gamma,
        ) },
        balance: { value: new THREE.Vector3(...value.balance) },
    }]),
) as Record<MaterialCalibrationTarget, {
    parameters: { value: any };
    balance: { value: any };
}>;

export const MATERIAL_CALIBRATION_GLSL = /* glsl */ `
    vec3 calibrateMaterialColor(vec3 color, vec4 parameters, vec3 balance) {
        color = max(color * parameters.x * balance, vec3(0.0));
        color = pow(color, vec3(parameters.w));
        float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = mix(vec3(luminance), color, parameters.z);
        color = (color - 0.5) * parameters.y + 0.5;
        return clamp(color, 0.0, 1.0);
    }
`;

export function setRuntimeMaterialCalibration(
    target: MaterialCalibrationTarget,
    calibration: MaterialCalibration,
): void {
    const current = values[target];
    const uniforms = MATERIAL_CALIBRATION_UNIFORMS[target];
    current.exposure = calibration.exposure;
    current.contrast = calibration.contrast;
    current.saturation = calibration.saturation;
    current.gamma = calibration.gamma;
    current.balance = [...calibration.balance];
    uniforms.parameters.value.set(
        current.exposure,
        current.contrast,
        current.saturation,
        current.gamma,
    );
    uniforms.balance.value.set(...current.balance);
}

export function getRuntimeMaterialCalibration(
    target: MaterialCalibrationTarget,
): MaterialCalibration {
    return structuredClone(values[target]);
}
