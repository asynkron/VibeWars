/**
 * Scale an already-resolved damage amount by the attacker's current health.
 *
 * Damage in the game is integer-valued, so fractional results round to the
 * nearest integer. A living attacker still deals at least one point when the
 * resolved hit was positive; dead attackers deal none. Health above max is
 * clamped so it cannot increase damage beyond the normal full-health value.
 */
export function scaleDamageByHealth(
    resolvedDamage: number,
    currentHp: number,
    maxHp: number,
): number {
    if (resolvedDamage <= 0 || currentHp <= 0 || maxHp <= 0) return 0;

    const healthFraction = Math.min(currentHp / maxHp, 1);
    return Math.max(1, Math.round(resolvedDamage * healthFraction));
}
