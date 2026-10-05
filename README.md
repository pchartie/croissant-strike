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

## Commandes

| Touche | Action |
|---|---|
| Z Q S D | Se déplacer (W A S D en QWERTY) |
| Souris | Viser (axe vertical inversé) |
| Clic gauche | Tirer |
| R | Recharger |
| 1 / 2 | Fusil (AK-47) / pistolet (USP) |
| Espace / molette | Sauter |
| Échap | Pause |

Le nombre en bas de l'écran est la vitesse en unités Source (250 = vitesse de course avec un couteau dans CS).

## Structure

```
src/
├── main.ts        point d'entrée
├── config.ts      constantes de jeu (vitesses, gravité, sensibilité…)
├── core/          boucle de jeu (physique à 128 ticks/s), clavier et souris, sons
├── world/         arène, collisions, textures
├── player/        déplacements façon CS: Source et caméra
├── weapons/       caractéristiques des armes, tir et recul, arme en main, impacts
└── ui/            HUD et écran de pause
```

Le réticule s'écarte selon la précision réelle de l'arme : il grandit quand on court, saute ou tire en rafale.

À venir : `bots/` (ennemis).
