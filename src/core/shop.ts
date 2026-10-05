import { GRENADES, type GrenadeType } from '../grenades/definitions';
import { PRIMARIES, type WeaponDef } from '../weapons/definitions';

/** Un article du menu d'achat, choisi avec une touche du rang des chiffres. */
export type ShopItem =
  | { code: string; key: string; label: string; price: number; kind: 'weapon'; weapon: WeaponDef }
  | { code: string; key: string; label: string; price: number; kind: 'armor' | 'helmet' }
  | { code: string; key: string; label: string; price: number; kind: 'grenade'; grenade: GrenadeType };

/** Prix des grenades et du gilet (CS:GO). */
const GRENADE_PRICES: Record<GrenadeType, number> = { he: 300, flash: 200, smoke: 300, molotov: 400, decoy: 50 };
export const ARMOR_PRICE = 650;
export const ARMOR_HELMET_PRICE = 1000;
/** Prix du casque seul quand on a déjà un gilet neuf. */
export const HELMET_UPGRADE_PRICE = 350;

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

export const SHOP_ITEMS: ShopItem[] = [
  ...PRIMARIES.map((weapon) => ({ kind: 'weapon' as const, label: weapon.name, price: weapon.price, weapon })),
  { kind: 'armor' as const, label: 'Gilet', price: ARMOR_PRICE },
  { kind: 'helmet' as const, label: 'Gilet + casque', price: ARMOR_HELMET_PRICE },
  ...(['he', 'flash', 'smoke', 'molotov'] as GrenadeType[]).map((grenade) => ({
    kind: 'grenade' as const,
    label: GRENADES[grenade].name,
    price: GRENADE_PRICES[grenade],
    grenade,
  })),
  { kind: 'grenade' as const, label: GRENADES.decoy.name, price: GRENADE_PRICES.decoy, grenade: 'decoy' as GrenadeType },
].map((item, i) => ({ ...item, key: DIGITS[i], code: `Digit${DIGITS[i]}` })) as ShopItem[];
