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

## En ligne (GitHub Pages)

Une GitHub Action (`.github/workflows/fps1-pages.yml`, à la racine du dépôt) compile et publie le jeu à chaque push qui touche `FPS1/`, à l'adresse **https://leochartrain.github.io/projets/**. À activer une seule fois : sur GitHub, *Settings → Pages → Source : GitHub Actions* (on peut aussi la lancer à la main depuis l'onglet *Actions*). Le Retro Weapon Pack n'étant pas dans le dépôt, la version en ligne utilise les armes en blocs ; le ciel, les textures et les sons, en CC0, y sont.

## Faire tester à distance (tunnel Cloudflare)

Sans compte ni nom de domaine, avec [cloudflared](https://github.com/cloudflare/cloudflared/releases) (ici dans `D:Tools`) :

```sh
npm run build                 # version compilée, plus rapide à travers le tunnel
npx vite preview --port 4173  # sert le dossier dist/
cloudflared tunnel --url http://localhost:4173
```

`cloudflared` affiche une adresse `https://….trycloudflare.com` à envoyer. Elle change à chaque lancement et ne marche que tant que les deux commandes tournent. `vite.config.ts` autorise ces adresses.

## Commandes (par défaut, modifiables dans les réglages)

| Touche | Action |
|---|---|
| Z Q S D | Se déplacer (W A S D en QWERTY) |
| Souris | Viser (axe vertical inversé par défaut, réglable) |
| Clic gauche | Tirer |
| R | Recharger |
| 1 / 2 / 3 | Arme principale (M4A1, MP5-SD ou Nova) / pistolet (M1911) / couteau |
| B | Menu d'achat (puis 1 à 0 pour acheter) |
| E | Poser la bombe (maintenir, en mode bombe) |
| Tab | Tableau des scores (maintenir) |
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
├── net/           jeu en ligne : connexion PeerJS, messages, adversaire affiché
├── bots/          ennemis et coéquipiers : modèle, IA (patrouille, combat, recherche), apparitions
└── ui/            HUD, fil des éliminations, écrans de pause et de mort
```

Le réticule est fixe, mais les balles se dispersent quand on court, saute ou tire en rafale : comme dans CS, il faut s'arrêter pour être précis.

## Interface

**Tab** (maintenu) : tableau des scores, avec éliminations, morts, headshots et précision. **Radar** en haut à gauche : la carte tourne avec le regard, et les ennemis apparaissent en rouge quand on les voit (ils s'effacent 1,5 s après). En fin de match (mode manches) : bilan avec éliminations, morts, précision, headshots et dégâts.

## Réglages

Le menu de pause (Échap) contient tous les réglages, mémorisés dans le navigateur :

- **Jeu** : mode, bots activés ou non, agressifs ou passifs, nombre d'ennemis (1 à 10), coéquipiers (0 à 4) et difficulté (facile, normale, difficile).
- **Contrôles** : sensibilité de la souris (même échelle que CS), axe vertical inversé ou non, champ de vision.
- **Audio et affichage** : volume, couleur et taille du réticule, compteur de vitesse.
- **Graphismes** : qualité des ombres (désactivées, basses, hautes), résolution de rendu (50 à 100 %, pour les PC moins puissants), compteur d'images par seconde.
- **Touches** : toutes les touches se changent (deux par action, clavier ou souris, molette comprise) : on clique sur une case puis on appuie sur la touche voulue. Les lettres s'affichent selon ton clavier (Z, Q, S, D en AZERTY).

Les réglages sont décrits dans `src/core/settings.ts` : le panneau est construit à partir de cette liste, donc ajouter un réglage se fait en quelques lignes. Les préréglages de difficulté sont dans `src/config.ts` (`DIFFICULTY`).

## Armes et équipement

Armes principales (touche 1, une seule à la fois) : **M4A1**, **MP5-SD** (SMG silencieux, précis en mouvement) et **Nova** (fusil à pompe, 9 plombs, rechargé cartouche par cartouche). Les dégâts baissent avec la distance comme dans CS. **Gilet** et **casque** : le gilet réduit les dégâts au corps et aux explosions selon l'arme, le casque protège la tête, rien ne protège les jambes ni le feu. Les bots portent gilet et casque.

## Couteau

Comme dans CS:GO (touche 3) : clic gauche rapide (40, puis 25 en enchaînant, 90 dans le dos, portée 1,2 m), clic droit puissant (65, 180 dans le dos, portée au contact). On le tient de la main droite, avec les mêmes bras que pour les armes à feu ; les coups sont animés par le code (balayage, coup de pointe).

## Modes de jeu

À choisir dans les réglages :

- **Deathmatch** : on réapparaît 3 s après chaque mort (avec gilet, casque et grenades), les bots aussi. Le menu d'achat (B) est gratuit : on y choisit son arme principale.
- **Manches** : comme dans CS, une vie par manche, avec l'économie de CS:GO (800 $ au départ, primes d'élimination selon l'arme, 3 250 $ par manche gagnée, bonus de défaite de 1 400 à 3 400 $). On achète avec B pendant le gel et les 20 premières secondes ; en survivant on garde son équipement, en mourant il ne reste que le pistolet. Tu pars du sud, les bots du nord. 3 s de gel au départ, 1:55 de chrono ; on gagne la manche en éliminant l'autre camp, et les bots la gagnent si le temps s'écoule. Le premier à 5 manches remporte le match. Réglages dans `src/config.ts`, section `ROUNDS`.
- **Bombe** : les manches de CS:GO sur le modèle de de_dust. Ton équipe (au sud) attaque : tu pars avec la bombe et dois la poser sur le **site A** (plateforme à l'ouest) ou le **site B** (à l'est), marqués au sol et sur le radar, en maintenant E 3,2 s sans bouger (+300 $). Elle explose 40 s plus tard (mortelle de près, dangereuse jusqu'à 20 m). Les ennemis gardent les deux sites, puis foncent vers la bombe et la désamorcent en 10 s ; la consigne en haut de l'écran indique où en est la bombe et qui la désamorce, et ses bips accélèrent. Une fois posée, ni le chrono ni la mort de ton équipe ne finissent la manche : seuls l'explosion, le désamorçage ou l'élimination de tous les ennemis le font. Si tu meurs avec la bombe, elle tombe et un coéquipier bot va la ramasser pour la poser lui-même. Réglages dans `src/config.ts`, section `BOMB`.

## En ligne (1 contre 1)

Dans le menu (Échap), encart **En ligne** : choisis un pseudo, puis **Créer une partie** pour recevoir un code de 4 caractères à donner à ton adversaire ; lui l'entre et clique sur **Rejoindre**. C'est un deathmatch à deux (réapparition 3 s après chaque mort, hors de vue de l'autre), sans bots pour l'instant ; armes, gilet, couteau (coups dans le dos compris) et les cinq grenades marchent comme contre les bots. Une grenade vole chez les deux joueurs, et celui qui la lance annonce où elle éclate : HE, flash, fumée et feu sont donc au même endroit sur les deux écrans. **Quitter la partie** (ou le départ de l'autre) ramène au jeu seul, avec tes réglages.

La connexion est directe entre les deux navigateurs (WebRTC, avec [PeerJS](https://peerjs.com)) : le serveur public de PeerJS sert seulement à se trouver grâce au code. Ça marche en local comme sur GitHub Pages, chacun chez soi. Sur certains réseaux très fermés (entreprise, certaines box), la connexion directe peut échouer. Chacun fait foi pour ses propres tirs (« je t'ai touché à la tête ») et l'autre applique les dégâts avec son gilet ; l'adversaire est affiché avec 100 ms de retard pour un mouvement fluide. Pour tester seul, ouvre le jeu dans deux fenêtres.

## Grenades

Les cinq grenades de CS:GO, avec ses valeurs (vitesse de lancer, gravité, rebonds) : **HE** (jusqu'à 98 de dégâts, arrêtée par les murs), **flash** (aveugle selon l'angle et la distance, toi comme les bots), **fumigène** (18 s, cache la vue des bots et éteint les molotovs), **molotov** (feu de 7 s, 40 dégâts par seconde) et **leurre** (imite des tirs de fusil pendant 15 s et attire les bots). On en reçoit une de chaque, plus une deuxième flash, à chaque manche ou réapparition. Les bots lancent aussi des HE et des flashs (voir Bots).

## Carte

**Dunes**, une petite carte façon de_dust de 72 × 72 m (`src/world/Level.ts`) : apparition au sud, trois voies vers le nord — la longue A à l'ouest jusqu'au site A surélevé, le milieu avec sa passerelle et ses portes, le couloir B à l'est jusqu'au site B. Les marches de moins de 46 cm se montent sans sauter, comme dans CS.

Textures de [Poly Haven](https://polyhaven.com) en CC0 à leur taille réelle (sable, crépi, grès, planches : `public/textures/`), et habillage façon de_dust : linteaux et poutres au-dessus des passages, battants de porte en bois, auvents sur poteaux, fenêtres, rebords de grès en haut des murs, barils et palettes.

## Ciel

Ciel HDR de [Poly Haven](https://polyhaven.com) en CC0 (`public/sky/`) : il sert de fond et d'éclairage ambiant, et le soleil du jeu est placé là où il apparaît dans le ciel, pour que les ombres soient cohérentes.

## Sons

**Pas** : on entend ses pas et ceux des bots (situés à gauche ou à droite), avec un bruit différent sur le sable, la pierre, le bois ou le métal ; silence en marchant (Maj) ou accroupi, comme dans CS. Les bots entendent les pas du joueur qui court à moins de 15 m et viennent voir. Les balles font aussi un bruit et des éclats selon la matière touchée (étincelles sur le métal, éclats de bois, gerbe de sable). Touché, on est ralenti un instant et la visée sursaute, comme dans CS:GO.

Vrais enregistrements d'armes (AR-15 et 1911) et de rechargements, en CC0 : voir `public/sounds/CREDITS.md`. Les tirs des bots utilisent une prise de son lointaine et viennent de gauche ou de droite selon leur position, pour les repérer à l'oreille. Si les fichiers manquent, le jeu revient aux sons synthétisés.

## Bots

Les bots patrouillent sur toute la carte (escaliers et plateformes compris), t'attaquent dès qu'ils te voient et vont voir quand ils t'entendent tirer ou courir. Ils tirent en rafales en s'arrêtant, puis se décalent sur le côté entre deux rafales (en sautant parfois). Chacun a une HE et une flash par vie : quand tu te caches, il peut lancer une flash avant d'aller te chercher, ou une HE sur ta cachette (lancer en cloche calculé pour exploser sur place). Une balle dans la tête fait ×4 de dégâts, dans les jambes ×0,75, pour eux comme pour toi.

**Coéquipiers** : jusqu'à 4 bots dans ton camp (réglage « Coéquipiers », 0 par défaut), en tenue bleu-gris. Ils combattent les ennemis avec la même IA, s'entendent tirer entre camps, et apparaissent groupés autour de toi en mode manches ; la manche continue tant qu'un membre de ton équipe est en vie. Pas de tir ami : tes balles les traversent, tes grenades et ton feu ne les blessent pas, et inversement. Ils sont toujours visibles sur le radar (en bleu) et ont leur ligne dans le tableau des scores.

En mode **passif** (dans les réglages), ils se promènent sans attaquer ni réagir aux tirs : pratique pour s'entraîner à viser.

Le nombre de bots et la difficulté se choisissent dans les réglages ; le détail de chaque niveau (temps de réaction, précision, chance de viser la tête…) est dans `src/config.ts`, section `DIFFICULTY`.
