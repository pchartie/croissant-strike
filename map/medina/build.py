"""Médina : vieille ville du Maghreb, trois voies et deux sites (plan : voir le README, section Carte).

Version grise : les zones jouables du plan, des bâtiments partout ailleurs, les portes, la terrasse A,
la passerelle, le toit du souk et de quoi se couvrir ; quadrillage de 1 m, éclairage précalculé.

Lancé par `npm run build-map -- medina`, qui appelle Blender ainsi :
    blender --background --python map/medina/build.py -- <dossier de sortie> <taille> <échantillons>

Coordonnées du jeu, en mètres : x vers l'est, y vers le haut, z vers le sud (le nord est en -z).
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(HERE, '..', 'lib'))

import bake  # noqa: E402
import kit  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
SIZE = int(args[1]) if len(args) > 1 else 2048
SAMPLES = int(args[2]) if len(args) > 2 else 256

# Limites de la carte (doivent correspondre à src/world/maps.ts).
X0, X1, Z0, Z1 = -40, 40, -46, 46
SUN_DIRECTION = (0.556, 0.742, 0.376)

# Hauteurs
A_HEIGHT = 1.2  # terrasse A et passerelle
DOOR = 3.0  # dessous des linteaux
WALL = 5.0  # murs en travers des rues (portes)
BIG, SMALL = 1.6, 0.9  # caisses, comme dans CS (la grosse se monte accroupi en sautant)

# Zones jouables (x1, z1, x2, z2), au sol ou surélevées : tout le reste est bâti.
WALKABLE = [
    (-10, 34, 10, 46),  # spawn T (place des potiers)
    (-40, 36, -10, 44),  # cour ouest, vers les Portes longues
    (10, 36, 30, 44),  # cour est, vers le souk
    (-40, -14, -30, 36),  # Longue
    (-30, 8, -26, 14),  # Coin
    (-40, -34, -10, -14),  # site A (terrasse)
    (-14, -14, -10, 0),  # passerelle
    (-14, 0, -10, 6),  # pied de l'escalier de la passerelle
    (-5, 6, 5, 34),  # Milieu (rue)
    (-10, -10, 10, 6),  # place du Milieu
    (-6, -34, 6, -10),  # couloir des Portes CT
    (-24, -46, 24, -34),  # spawn CT (esplanade)
    (10, -6, 18, -1),  # Ruelle
    (18, -34, 40, 6),  # site B (cour de la fontaine)
    (22, 6, 30, 36),  # Souk
]

kit.reset_scene(os.path.join(ROOT, 'public', 'textures'))
carte = kit.Kit((X0, 0, Z0), (X1, 100, Z1))
WALLS, FLOOR, RAISED, COVER, OVER = 'greyWall', 'greyFloor', 'greyRaised', 'greyCover', 'greyOverhead'


def box(x1, z1, x2, z2, y1, y2, material, surface, top=True):
    carte.box((x1, y1, z1), (x2, y2, z2), material, 1.0, surface, top=top)


def crate(x, z, size=BIG, y=0.0):
    box(x - size / 2, z - size / 2, x + size / 2, z + size / 2, y, y + size, COVER, 'wood')


def door_wall(axis, at, span, opening):
    """Mur en travers d'une rue (épaisseur 1 m centrée sur `at`), percé d'une porte avec linteau."""
    (a, b), (o1, o2) = span, opening
    for p1, p2, y1, y2 in ((a, o1, 0, WALL), (o2, b, 0, WALL), (o1, o2, DOOR, WALL)):
        if axis == 'z':  # mur le long de x, à z = at
            box(p1, at - 0.5, p2, at + 0.5, y1, y2, WALLS, 'plaster', top=False)
        else:  # mur le long de z, à x = at
            box(at - 0.5, p1, at + 0.5, p2, y1, y2, WALLS, 'plaster', top=False)


# --- Sol, enceinte et bâtiments ---
box(X0, Z0, X1, Z1, -1, 0, FLOOR, 'sand')
for x1, z1, x2, z2 in ((X0 - 1, Z0 - 1, X0, Z1 + 1), (X1, Z0 - 1, X1 + 1, Z1 + 1), (X0, Z0 - 1, X1, Z0), (X0, Z1, X1, Z1 + 1)):
    box(x1, z1, x2, z2, 0, 9, WALLS, 'plaster', top=False)


def building_height(x1, z1, x2, z2):
    """Hauteurs variées (5 à 7,25 m), toujours au-dessus de ce qu'on voit depuis le sol ; plus haut au nord."""
    h = 5.0 + (int(abs(x1 * 7 + z1 * 13 + x2 * 3)) % 4) * 0.75
    return h + (2.0 if z2 <= -40 else 0.0)


carte.fill_buildings(WALKABLE, building_height, WALLS)

# --- Voie A : Portes longues, escalier vers la terrasse ---
door_wall('z', 30, (-40, -30), (-37, -33))
carte.stairs('z', -12.2, -1, (-40, -30), 3, RAISED, surface='stone')
crate(-32, 12)
crate(-38.2, -4, SMALL)
crate(-38.2, -3.1, SMALL)
crate(-38.2, 22)

# --- Site A : terrasse, Plateau, Rampe CT ---
box(-40, -34, -10, -14, 0, A_HEIGHT, RAISED, 'stone')
box(-30, -28, -24, -22, A_HEIGHT, A_HEIGHT * 2, COVER, 'stone')
crate(-36, -30, BIG, A_HEIGHT)
crate(-17, -20, BIG, A_HEIGHT)
crate(-13, -31, SMALL, A_HEIGHT)
crate(-13, -31, SMALL, A_HEIGHT + SMALL)
carte.stairs('z', -35.8, 1, (-22, -14), 3, RAISED, surface='stone')

# --- Passerelle : galerie surélevée le long de la place, escalier au sud, garde-corps ouvert au milieu ---
box(-14, -14, -10, 0, 0, A_HEIGHT, RAISED, 'stone')
carte.stairs('z', 3, -1, (-14, -10), 3, RAISED, surface='stone', depth=1.0)
box(-10.2, -10, -10, -6, A_HEIGHT, A_HEIGHT + 0.9, RAISED, 'stone')
box(-10.2, -3, -10, 0, A_HEIGHT, A_HEIGHT + 0.9, RAISED, 'stone')

# --- Milieu : arche, caisse, puits, Portes CT ---
box(-5, 19.5, 5, 20.5, 3.5, 5.5, OVER, 'stone', top=False)
crate(-3.5, 26)
box(-1.3, -3.3, 1.3, -0.7, 0, 1.0, COVER, 'stone')
door_wall('z', -10, (-6, 6), (-2, 2))

# --- Ruelle et Portes B ---
door_wall('x', 17.5, (-6, -1), (-5, -2))

# --- Site B : fontaine, caisses ---
box(26.8, -16.2, 31.2, -11.8, 0, 0.8, COVER, 'stone')
crate(22, -28)
crate(36, -6)
crate(24, -4, SMALL)
crate(35, -24)
crate(35, -24, SMALL, BIG)

# --- Souk : bandes de toile à 3,4 m (la lumière passe entre elles, en rayures), étals contre les murs ---
z = 6.6
while z + 2 <= 36:
    box(22, z, 30, z + 2, 3.4, 3.5, OVER, 'wood', top=False)
    z += 3.2
for z1, z2 in ((10, 13), (20, 23), (28, 31)):
    box(22, z1, 23.2, z2, 0, 1.0, COVER, 'wood')
for z1, z2 in ((15, 18), (25, 28)):
    box(28.8, z1, 30, z2, 0, 1.0, COVER, 'wood')

# --- Spawns ---
crate(-6, 42)
crate(7, 41, SMALL)
crate(-4, -42)
crate(10, -41)

obj = carte.build('medina')
bake.setup_lighting(SUN_DIRECTION, 2.5, os.path.join(ROOT, 'public', 'sky', 'sky.hdr'), sky_irradiance=1.9)
density = bake.lightmap_uv(obj, SIZE)
image = bake.bake(obj, SIZE, SAMPLES)
os.makedirs(OUT, exist_ok=True)
scale = bake.save_lightmap(image, os.path.join(OUT, 'lightmap.png'))
bake.export_glb(obj, os.path.join(OUT, 'medina.glb'))
bake.write_json(os.path.join(OUT, 'medina.json'), {
    'lightmapScale': scale,
    'lightmapDensity': density,
    'collisions': carte.collisions(),
    'props': [],
})
