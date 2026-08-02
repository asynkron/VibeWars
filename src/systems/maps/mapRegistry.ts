// Map selection: every playable map registers here, chosen via the
// ?map=<key> URL parameter (constants.ts reads the same parameter for the
// size table -- see the note in MapProvider.ts about why size lives there).

import { MAP_KEY, MAP_CONFIG } from '../../constants';
import { MapProvider } from './MapProvider';
import { mirror8MapProvider } from './Mirror8MapProvider';
import { perlinMapProvider } from './PerlinMapProvider';

const providers: MapProvider[] = [mirror8MapProvider, perlinMapProvider];

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
