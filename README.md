# FPS1

Jeu de tir à la première personne en solo, inspiré de Counter-Strike: Source.
Fait avec [Three.js](https://threejs.org), TypeScript et [Vite](https://vite.dev).

## Lancer

Il faut [Node.js](https://nodejs.org) 20 ou plus.

```sh
npm install     # une seule fois
npm run dev     # puis ouvrir http://localhost:5173
```

`npm run build` produit une version finale dans `dist/`.

### Armes et bras animés (optionnel)

Le jeu utilise les armes et les bras animés du [Retro Weapon Pack](https://kuptchi.itch.io/) (gratuit, usage commercial autorisé). Ils ne sont pas dans le dépôt : sans eux, le jeu affiche des armes en blocs.

1. Télécharger `RetroWeaponPack_V1.zip` et le poser dans `FPS1/`.
2. Lancer `npm run import-weapons`.

Le script extrait du zip (500 Mo) uniquement ce qui sert et compresse les animations : il reste ~2 Mo dans `public/assets/weapons/`.

## Commandes

| Touche | Action |
|---|---|
| Z Q S D | Se déplacer (W A S D en QWERTY) |
| Souris | Viser (axe vertical inversé) |
| Clic gauche | Tirer |
| R | Recharger |
| 1 / 2 | Fusil (M4A1) / pistolet (M1911) |
| Espace / molette | Sauter |
| Ctrl ou C | S'accroupir (plus lent, plus précis ; sauter accroupi permet de monter sur les grosses caisses) |
| Maj | Marcher lentement |
| Échap | Pause |

Le nombre en bas de l'écran est la vitesse en unités Source (250 = vitesse de course avec un couteau dans CS).

## Structure

```
src/
├── main.ts        point d'entrée
├── config.ts      constantes de jeu (vitesses, gravité, sensibilité, difficulté des bots…)
├── core/          boucle de jeu (physique à 128 ticks/s), clavier et souris, sons
├── world/         carte, collisions (avec marches), grille de navigation des bots, textures
├── player/        déplacements façon CS: Source et caméra
├── weapons/       caractéristiques des armes, tir et recul, arme en main, impacts
├── bots/          ennemis : modèle, IA (patrouille, combat, recherche), apparitions
└── ui/            HUD, fil des éliminations, écrans de pause et de mort
```

Le réticule est fixe, mais les balles se dispersent quand on court, saute ou tire en rafale : comme dans CS, il faut s'arrêter pour être précis.

## Carte

**Dunes**, une petite carte façon de_dust de 72 × 72 m (`src/world/Level.ts`) : apparition au sud, trois voies vers le nord — la longue A à l'ouest jusqu'au site A surélevé, le milieu avec sa passerelle et ses portes, le couloir B à l'est jusqu'au site B. Les marches de moins de 46 cm se montent sans sauter, comme dans CS.

## Bots

Les bots patrouillent sur toute la carte (escaliers et plateformes compris), t'attaquent dès qu'ils te voient et vont voir quand ils t'entendent tirer. Ils tirent en rafales en s'arrêtant, puis se décalent sur le côté entre deux rafales. Une balle dans la tête fait ×4 de dégâts, dans les jambes ×0,75, pour eux comme pour toi.

Dans le menu de pause (Échap), deux boutons permettent de **désactiver les bots** et de les rendre **passifs** : ils se promènent sans attaquer ni réagir aux tirs, pratique pour s'entraîner à viser. Ces réglages sont mémorisés d'une partie à l'autre.

Le nombre de bots et leur difficulté (temps de réaction, précision, chance de viser la tête…) se règlent dans `src/config.ts`, section `BOTS`.
