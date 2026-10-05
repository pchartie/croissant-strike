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
├── config.ts      constantes de jeu (vitesses, gravité, sensibilité, difficulté des bots…)
├── core/          boucle de jeu (physique à 128 ticks/s), clavier et souris, sons
├── world/         arène, collisions, grille de navigation des bots, textures
├── player/        déplacements façon CS: Source et caméra
├── weapons/       caractéristiques des armes, tir et recul, arme en main, impacts
├── bots/          ennemis : modèle, IA (patrouille, combat, recherche), apparitions
└── ui/            HUD, fil des éliminations, écrans de pause et de mort
```

Le réticule est fixe, mais les balles se dispersent quand on court, saute ou tire en rafale : comme dans CS, il faut s'arrêter pour être précis.

## Bots

Les bots patrouillent dans l'arène, t'attaquent dès qu'ils te voient et vont voir quand ils t'entendent tirer. Ils tirent en rafales en s'arrêtant, puis se décalent sur le côté entre deux rafales. Une balle dans la tête fait ×4 de dégâts, dans les jambes ×0,75, pour eux comme pour toi.

Le nombre de bots et leur difficulté (temps de réaction, précision, chance de viser la tête…) se règlent dans `src/config.ts`, section `BOTS`.
