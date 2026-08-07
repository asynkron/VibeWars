// The frozen 2026-08-05 Feint, adapted into today's registry -- see
// src/reference/feint0805/README.md for what that folder is and why it
// may never be edited. THIS file is the only sanctioned bridge: any glue
// the old engine needs to run against today's game lives here, never in
// the frozen copy.
//
// The old engine plans with its own frozen rules -- its own SimState
// semantics, its aggression gradient, no production, no foresight --
// while the match loop it plays in runs today's rules. That mismatch is
// the point: a fixed reference the current engine is always measurable
// against, drift and all.
//
// The cast is honest about the seam: the frozen AIEngine type and
// today's are structurally near-identical (planTurn/withBudget/options),
// but their SimState parameter types come from two different frozen
// classes, and TypeScript rightly refuses to unify them. The runtime
// only ever calls methods both share.

import { feintEngine as frozenFeint } from '../../../../reference/feint0805/systems/sim/ai/engines/feint';
import type { AIEngine } from '../AIEngine';

export const feintReferenceEngine = frozenFeint as unknown as AIEngine;
