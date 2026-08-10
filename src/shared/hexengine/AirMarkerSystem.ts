import { scene } from '../../render';
import { getGameStateOrNull } from '../../systems/gameStateStore';
import { HexCoord } from './HexCoord';
import { TerrainSystem } from './TerrainSystem';
import { players, VISUAL_OFFSETS } from '../../constants';

// Which hex is that helicopter standing on?
//
// From a camera looking down at an angle, an object four units in the air
// does not appear over the tile it occupies -- perspective slides it up and
// away, further the higher it flies and the lower the camera sits. The
// board says the Nightjar is on (7, 3); the screen says it is somewhere
// over the ridge behind. Every air unit therefore gets two things, in its
// owner's colour and at all times, for both sides:
//
//   A TETHER straight down from the aircraft to the ground beneath it, so
//   the eye can follow it to the surface.
//
//   A SYMBOL lying on the tile itself, so the tile is marked even when the
//   aircraft is off screen, behind terrain, or overlapping another unit.
//
// This marker is positional rather than a turn highlight, so it stays visible
// for aircraft on both sides.

// Drawn once, tinted per team through material.color.
const GLYPH_SIZE = 128;

const UP = new THREE.Vector3(0, 1, 0);
// Lays the icon plane on the ground. The glyph is drawn nose-up on the
// canvas, which is the plane's local +Y, and this maps that to world -Z.
const FLAT = new THREE.Euler(-Math.PI / 2, 0, 0);
// ...which is NORTH, while a unit model at rotation.y = 0 faces +Z, south
// -- see UnitSystem.getRotation, whose comment states the convention. So
// the glyph was pointing the opposite way to the aircraft above it. Half a
// turn puts the nose on the model's nose, and the unit's own yaw goes on
// top of it so the symbol turns as the aircraft turns.
const GLYPH_YAW_OFFSET = Math.PI;

// How far the symbol floats over the tile.
//
// Set by the GRASS, not by taste: a blade is 0.30 tall and instances scale
// to 1.35 of that, so anything under 0.41 is inside the turf and mown down
// by it. Just clear of the tallest blade, close enough to the ground to
// still read as lying on the tile.
const GLYPH_CLEARANCE = 0.45;

function glyphTexture(kind: 'helo' | 'jet'): any {
    const canvas = document.createElement('canvas');
    canvas.width = GLYPH_SIZE;
    canvas.height = GLYPH_SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const c = GLYPH_SIZE / 2;

    if (kind === 'helo') {
        // Rotor disc across the whole glyph, a stubby body, a tail boom:
        // read from above, that is what tells a helicopter from a jet.
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.moveTo(c - 52, c - 52); ctx.lineTo(c + 52, c + 52);
        ctx.moveTo(c + 52, c - 52); ctx.lineTo(c - 52, c + 52);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(c, c + 4, 15, 26, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 11;
        ctx.beginPath();
        ctx.moveTo(c, c + 20); ctx.lineTo(c, c + 52);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(c - 16, c + 52); ctx.lineTo(c + 16, c + 52);
        ctx.stroke();
    } else {
        // A delta: nose up, swept wings, tailplane.
        ctx.beginPath();
        ctx.moveTo(c, c - 54);
        ctx.lineTo(c + 12, c - 6);
        ctx.lineTo(c + 50, c + 22);
        ctx.lineTo(c + 50, c + 34);
        ctx.lineTo(c + 10, c + 24);
        ctx.lineTo(c + 8, c + 44);
        ctx.lineTo(c + 22, c + 56);
        ctx.lineTo(c + 22, c + 62);
        ctx.lineTo(c, c + 54);
        ctx.lineTo(c - 22, c + 62);
        ctx.lineTo(c - 22, c + 56);
        ctx.lineTo(c - 8, c + 44);
        ctx.lineTo(c - 10, c + 24);
        ctx.lineTo(c - 50, c + 34);
        ctx.lineTo(c - 50, c + 22);
        ctx.lineTo(c - 12, c - 6);
        ctx.closePath();
        ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
}

class AirMarkerSystem {
    // Keyed by the unit's visualUnit, which survives everything except the
    // unit's own removal -- q/r change every move and the game object is
    // rebuilt on load.
    private static markers = new Map<any, { tether: any; icon: any }>();
    private static textures: Record<string, any> = {};
    // Scratch, so the per-frame update allocates nothing.
    private static readonly yaw = new THREE.Quaternion();

    private static texture(kind: 'helo' | 'jet'): any {
        if (!this.textures[kind]) this.textures[kind] = glyphTexture(kind);
        return this.textures[kind];
    }

    private static build(unit: any, colour: number): { tether: any; icon: any } {
        // Unit height: scaled to span aircraft-to-ground every frame, so the
        // geometry is a unit cylinder and the transform does the work.
        const tether = new THREE.Mesh(
            new THREE.CylinderGeometry(0.022, 0.022, 1, 6, 1, true),
            new THREE.MeshBasicMaterial({
                color: colour, transparent: true, opacity: 0.55, depthWrite: false,
            })
        );
        scene.add(tether);

        const kind = unit.visualUnit?.userData?.airGlyph === 'jet' ? 'jet' : 'helo';
        const icon = new THREE.Mesh(
            new THREE.PlaneGeometry(0.95, 0.95),
            new THREE.MeshBasicMaterial({
                map: this.texture(kind), color: colour,
                transparent: true, opacity: 0.9,
                depthWrite: false,
                // DEPTH-TESTED LIKE EVERYTHING ELSE. Drawing it on top of
                // the whole scene did keep it visible, and it also let it
                // shine through hills and hulls standing in front of it,
                // which reads as a bug rather than as a marker. It obeys
                // the buffer; the clearance below is what keeps it out of
                // the grass.
                depthTest: true,
            })
        );
        // Laid flat; the heading is applied per frame in update().
        icon.quaternion.setFromEuler(FLAT);
        // After the highlights and footprints, which are the other things
        // drawn flat on a tile.
        icon.renderOrder = 900;
        scene.add(icon);

        return { tether, icon };
    }

    private static dispose(marker: { tether: any; icon: any }): void {
        scene.remove(marker.tether);
        scene.remove(marker.icon);
        marker.tether.geometry.dispose();
        marker.tether.material.dispose();
        marker.icon.geometry.dispose();
        // The glyph texture is shared and cached -- not this mesh's to free.
        marker.icon.material.dispose();
    }

    // Called every frame. Rebuilt from the live unit list rather than hooked
    // into spawn and death, so a unit that dies, is carried, or is added by
    // a factory needs no notification here to be right.
    static update(): void {
        const state = getGameStateOrNull();
        if (!state) {
            for (const marker of this.markers.values()) this.dispose(marker);
            this.markers.clear();
            return;
        }

        const seen = new Set<any>();
        for (const unit of state.units) {
            const visual = unit.visualUnit;
            if (!visual || !(visual.userData?.flightAltitude > 0)) continue;
            // A passenger is inside a hull on the ground; it has no altitude
            // of its own to point at.
            if (unit.carriedBy != null) continue;
            if (!visual.visible) continue;

            seen.add(visual);
            let marker = this.markers.get(visual);
            if (!marker) {
                marker = this.build(unit, players[unit.playerIndex].color);
                this.markers.set(visual, marker);
            }

            const hex = HexCoord.findHex(unit.q, unit.r);
            if (!hex) continue;
            const groundY = TerrainSystem.getHeight(hex) + VISUAL_OFFSETS.FOOTPRINT_OFFSET;
            const x = visual.position.x, z = visual.position.z;
            const span = Math.max(0.05, visual.position.y - groundY);

            marker.tether.position.set(x, groundY + span / 2, z);
            marker.tether.scale.set(1, span, 1);

            // The symbol marks the TILE, so it sits at the hex's centre --
            // not under the aircraft, which drifts off it while moving and
            // would leave the marker pointing at nothing in particular.
            const centre = new HexCoord(unit.q, unit.r).getWorldPosition();
            marker.icon.position.set(centre.x, groundY + GLYPH_CLEARANCE, centre.z);
            // Heading, tracked live: the aircraft turns as it flies, and a
            // symbol frozen in one direction reads as a mistake the moment
            // the two disagree.
            marker.icon.quaternion.setFromEuler(FLAT);
            marker.icon.quaternion.premultiply(
                AirMarkerSystem.yaw.setFromAxisAngle(UP, visual.rotation.y + GLYPH_YAW_OFFSET));
        }

        for (const [visual, marker] of this.markers) {
            if (seen.has(visual)) continue;
            this.dispose(marker);
            this.markers.delete(visual);
        }
    }
}

export { AirMarkerSystem };
