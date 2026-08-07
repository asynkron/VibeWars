// THE GROVE. Open ground on the west, one unbroken forest on the east,
// and a Kestrel parked deep inside it. The Kestrel out-ranges the Pike
// (range 2-3, 3-5 damage against 4 hp, and minRange 2 so it cannot answer
// an adjacent blade), so walking straight at it is close to suicide --
// and unlike the immobile Mortar that first held this seat, it MOVES:
// move 2 against forest cost 2 is one tile per turn inside the grove, so
// it can advance on the Pike, kite, or flee a fire. The Pike spawns one
// step from the treeline with its fire skill ready.
//
// The fire arithmetic stays exact -- 3 hp, and a burning tile costs 1 hp
// per own turn standing in it, three own turns per fire lifetime: caught
// in flame and unable to leave, it dies untouched by any weapon. With a
// MOBILE target the exam is dynamic: the fire must chase, cut off, or
// flush. This board is what drove two engine changes, in order: the
// useSkill gene (the Pike could not even SAY "light it") and then
// frozen-future foresight (saying it was worthless while the payoff lay
// fifteen turns past a depth-3 horizon -- see PlanTurnOptions.foresight).
// With both in place the shipped engine opens with the ignition, steps
// away from its own fire, and burns the artillery to death without
// firing a shot -- fireGrove.test.ts gates on exactly that.
//
// A SCENARIO map, like the chokes: deliberately asymmetric, registered in
// SCENARIO_PROVIDERS and never in AUTHORED_PROVIDERS. The picture is
// imported by systems/sim/scenarios/fireGrove.test.ts so the playable map
// and the exam can never drift apart.

import { MapProvider } from './MapProvider';
import { providerFrom, PictureLegendEntry } from './ChokeMapProvider';

// Row index is r, column index is q. P stands ON grass one step west of
// the treeline; A stands ON forest (ground '#') deep in the grove.
export const GROVE_PICTURE: string[] = [
    '.........########',
    '.......P########A',
    '.........########',
];

export const GROVE_LEGEND: Record<string, PictureLegendEntry> = {
    P: { type: 'Pike', player: 0 },
    A: { type: 'Kestrel', player: 1, ground: '#' },
};

export const groveMapProvider: MapProvider = providerFrom(
    'grove', 'Skogsbranden (17x3)', GROVE_PICTURE, GROVE_LEGEND);
