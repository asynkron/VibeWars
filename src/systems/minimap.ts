import { Vector3, type OrthographicCamera } from 'three';

export function getMinimapWorldPosition(
    pointer: { clientX: number; clientY: number },
    overlay: Pick<HTMLElement, 'getBoundingClientRect'>,
    camera: OrthographicCamera,
): Vector3 | null {
    const rect = overlay.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = Math.max(0, Math.min(1, (pointer.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (pointer.clientY - rect.top) / rect.height));
    camera.updateMatrixWorld();
    const position = new Vector3(x * 2 - 1, 1 - y * 2, 0).unproject(camera);
    position.y = 0;
    return position;
}
