/** Gilet pare-balles (0 à 100 points) et casque, comme dans CS. */
export interface Armored {
  armor: number;
  helmet: boolean;
}

/** Où arrivent les dégâts : zones du corps, souffle d'une explosion, ou feu. */
export type DamageZone = 'head' | 'body' | 'legs' | 'blast' | 'fire';

/** Pour une explosion, le gilet laisse passer la moitié des dégâts (CS:GO). */
export const BLAST_ARMOR_RATIO = 0.5;

/**
 * Dégâts reçus par quelqu'un qui porte peut-être un gilet (et un casque) : le
 * gilet protège le corps et le souffle des explosions, le casque la tête, rien
 * ne protège les jambes ni le feu. `ratio` est la part qui passe le gilet
 * (propre à chaque arme) ; le gilet perd la moitié de ce qu'il arrête. Renvoie
 * les dégâts à retirer de la santé, et use le gilet.
 */
export function absorbDamage(target: Armored, damage: number, zone: DamageZone, ratio: number): number {
  const protectedZone = zone === 'body' || zone === 'blast' || (zone === 'head' && target.helmet);
  if (!protectedZone || target.armor <= 0) return damage;

  let health = damage * ratio;
  let armor = (damage - health) * 0.5;
  if (armor > target.armor) {
    // Gilet trop usé : il n'arrête que ce qui lui reste.
    health = Math.max(health, damage - target.armor * 2);
    armor = target.armor;
  }
  target.armor = Math.max(0, target.armor - armor);
  return health;
}
