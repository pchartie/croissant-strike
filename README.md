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

## Faire tester à distance (tunnel Cloudflare)

Sans compte ni nom de domaine, avec [cloudflared](https://github.com/cloudflare/cloudflared/releases) (ici dans `D:Tools`) :

```sh
npm run build                 # version compilée, plus rapide à travers le tunnel
npx vite preview --port 4173  # sert le dossier dist/
cloudflared tunnel --url http://localhost:4173
```

`cloudflared` affiche une adresse `https://….trycloudflare.com` à envoyer. Elle change à chaque lancement et ne marche que tant que les deux commandes tournent. `vite.config.ts` autorise ces adresses.

## Commandes

| Touche | Action |
|---|---|
| Z Q S D | Se déplacer (W A S D en QWERTY) |
| Souris | Viser (axe vertical inversé par défaut, réglable) |
| Clic gauche | Tirer |
| R | Recharger |
| 1 / 2 / 3 | Fusil (M4A1) / pistolet (M1911) / couteau |
| Clic gauche / droit | Avec le couteau : coup rapide / coup puissant |
| 4 | Grenades (appuyer à nouveau pour passer à la suivante) |
| Clic gauche / droit / les deux | Avec une grenade : lancer loin / en cloche / à mi-distance |
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
├── grenades/      les 5 grenades : lancer, rebonds, explosion, flash, fumée, feu, leurre
├── bots/          ennemis : modèle, IA (patrouille, combat, recherche), apparitions
└── ui/            HUD, fil des éliminations, écrans de pause et de mort
```

Le réticule est fixe, mais les balles se dispersent quand on court, saute ou tire en rafale : comme dans CS, il faut s'arrêter pour être précis.

## Réglages

Le menu de pause (Échap) contient tous les réglages, mémorisés dans le navigateur :

- **Jeu** : mode, bots activés ou non, agressifs ou passifs, nombre (1 à 10) et difficulté (facile, normale, difficile).
- **Contrôles** : sensibilité de la souris (même échelle que CS), axe vertical inversé ou non, champ de vision.
- **Audio et affichage** : volume, couleur et taille du réticule, compteur de vitesse.
- **Touches** : récapitulatif des commandes.

Les réglages sont décrits dans `src/core/settings.ts` : le panneau est construit à partir de cette liste, donc ajouter un réglage se fait en quelques lignes. Les préréglages de difficulté sont dans `src/config.ts` (`DIFFICULTY`).

## Couteau

Comme dans CS:GO (touche 3) : clic gauche rapide (40, puis 25 en enchaînant, 90 dans le dos, portée 1,2 m), clic droit puissant (65, 180 dans le dos, portée au contact). On le tient de la main droite, avec les mêmes bras que pour les armes à feu ; les coups sont animés par le code (balayage, coup de pointe).

## Modes de jeu

À choisir dans les réglages :

- **Deathmatch** : on réapparaît 3 s après chaque mort, les bots aussi.
- **Manches** : comme dans CS, une vie par manche. Tu pars du sud, les bots du nord. 3 s de gel au départ, 1:55 de chrono ; on gagne la manche en éliminant l'autre camp, et les bots la gagnent si le temps s'écoule. Le premier à 5 manches remporte le match. Réglages dans `src/config.ts`, section `ROUNDS`.

## Grenades

Les cinq grenades de CS:GO, avec ses valeurs (vitesse de lancer, gravité, rebonds) : **HE** (jusqu'à 98 de dégâts, arrêtée par les murs), **flash** (aveugle selon l'angle et la distance, toi comme les bots), **fumigène** (18 s, cache la vue des bots et éteint les molotovs), **molotov** (feu de 7 s, 40 dégâts par seconde) et **leurre** (imite des tirs de fusil pendant 15 s et attire les bots). On en reçoit une de chaque, plus une deuxième flash, à chaque manche ou réapparition. Les bots n'en lancent pas encore.

## Carte

**Dunes**, une petite carte façon de_dust de 72 × 72 m (`src/world/Level.ts`) : apparition au sud, trois voies vers le nord — la longue A à l'ouest jusqu'au site A surélevé, le milieu avec sa passerelle et ses portes, le couloir B à l'est jusqu'au site B. Les marches de moins de 46 cm se montent sans sauter, comme dans CS.

## Ciel

Ciel HDR de [Poly Haven](https://polyhaven.com) en CC0 (`public/sky/`) : il sert de fond et d'éclairage ambiant, et le soleil du jeu est placé là où il apparaît dans le ciel, pour que les ombres soient cohérentes.

## Sons

Vrais enregistrements d'armes (AR-15 et 1911) et de rechargements, en CC0 : voir `public/sounds/CREDITS.md`. Les tirs des bots utilisent une prise de son lointaine et viennent de gauche ou de droite selon leur position, pour les repérer à l'oreille. Si les fichiers manquent, le jeu revient aux sons synthétisés.

## Bots

Les bots patrouillent sur toute la carte (escaliers et plateformes compris), t'attaquent dès qu'ils te voient et vont voir quand ils t'entendent tirer. Ils tirent en rafales en s'arrêtant, puis se décalent sur le côté entre deux rafales. Une balle dans la tête fait ×4 de dégâts, dans les jambes ×0,75, pour eux comme pour toi.

En mode **passif** (dans les réglages), ils se promènent sans attaquer ni réagir aux tirs : pratique pour s'entraîner à viser.

Le nombre de bots et la difficulté se choisissent dans les réglages ; le détail de chaque niveau (temps de réaction, précision, chance de viser la tête…) est dans `src/config.ts`, section `DIFFICULTY`.
