// Map selection: every playable map registers here, chosen via the
// ?map=<key> URL parameter (constants.ts reads the same parameter for the
// size table -- see the note in MapProvider.ts about why size lives there).

import { MAP_KEY, MAP_CONFIG } from '../../constants';
import { MapProvider } from './MapProvider';
import { ford10MapProvider } from './Ford10MapProvider';
import { crown14MapProvider } from './Crown14MapProvider';
import { mirror8MapProvider } from './Mirror8MapProvider';
import { rotor12x18MapProvider } from './Rotor12x18MapProvider';
import { chokeMapProvider, chokeRetreatMapProvider, chokeTwinMapProvider } from './ChokeMapProvider';
import { groveMapProvider } from './GroveMapProvider';
import {
    fixedRandomMediumMapProvider,
    randomLargeMapProvider,
    randomMediumMapProvider,
    randomSmallMapProvider,
} from './PerlinMapProvider';

// The authored maps: hand-drawn, symmetric, and identical on every load.
// These are the competitive ones, and the fairness battery in
// authoredMaps.test.ts runs over exactly this list -- adding a map here is
// what subjects it to the tests, which is the point.
export const AUTHORED_PROVIDERS: MapProvider[] = [
    mirror8MapProvider,
    rotor12x18MapProvider,
    ford10MapProvider,
    crown14MapProvider,
];

// The random maps: one perlin generator, three sizes. Not symmetric and
// different every load, so the fairness battery does not apply to them.
export const RANDOM_PROVIDERS: MapProvider[] = [
    randomSmallMapProvider,
    randomMediumMapProvider,
    fixedRandomMediumMapProvider,
    randomLargeMapProvider,
];

// The scenario maps: deliberately ASYMMETRIC tactical questions with a
// known right answer, shared with the sim scenario tests. Their own list
// because the authored battery would (correctly) fail them on fairness --
// unfairness is the exercise.
export const SCENARIO_PROVIDERS: MapProvider[] = [
    chokeMapProvider,
    chokeRetreatMapProvider,
    chokeTwinMapProvider,
    groveMapProvider,
];

// Default first: selectedMapProvider() falls back to providers[0] when the
// URL asks for a key nobody registered.
const providers: MapProvider[] = [
    rotor12x18MapProvider,
    ...AUTHORED_PROVIDERS.filter((p) => p !== rotor12x18MapProvider),
    ...RANDOM_PROVIDERS,
    ...SCENARIO_PROVIDERS,
];

export function allMapProviders(): MapProvider[] {
    return providers;
}

export function getMapProvider(key: string): MapProvider | undefined {
    return providers.find((p) => p.key === key);
}

export function selectedMapProvider(): MapProvider {
    const provider = getMapProvider(MAP_KEY) ?? providers[0];
    // The size table in constants.ts must agree with the provider --
    // everything from hex-grid creation to camera framing reads
    // MAP_CONFIG at startup. Fail loudly if they drift apart.
    if (provider.rows !== MAP_CONFIG.ROWS || provider.cols !== MAP_CONFIG.COLS) {
        throw new Error(
            `Map size mismatch for "${provider.key}": provider is ${provider.cols}x${provider.rows}, ` +
            `MAP_CONFIG is ${MAP_CONFIG.COLS}x${MAP_CONFIG.ROWS}. Update MAP_SIZES in constants.ts.`
        );
    }
    return provider;
}
