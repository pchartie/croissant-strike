import { WEAPONS, type WeaponId } from '../weapons/definitions';

// Silhouettes des armes à feu (tirées du pack d'armes par `npm run import-weapons`).

const BASE = `${import.meta.env.BASE_URL}assets/weapons/`;
const WITH_ICON: WeaponId[] = ['rifle', 'smg', 'shotgun', 'pistol'];
const loaded = new Set<WeaponId>();
for (const id of WITH_ICON) {
  const image = new Image();
  image.onload = () => loaded.add(id);
  image.src = `${BASE}${id}-icon.png`;
}

/**
 * Icône d'une arme, d'après son identifiant (`rifle`) ou son nom affiché (`M4A1`) ;
 * null pour le couteau et les grenades, ou si l'image n'est pas (encore) chargée : on affiche alors le nom.
 */
export function weaponIcon(idOrName: string): string | null {
  const id = WITH_ICON.find((weapon) => weapon === idOrName || WEAPONS[weapon].name === idOrName);
  return id && loaded.has(id) ? `${BASE}${id}-icon.png` : null;
}
