"""Dunes : la carte d'origine (blocs exportés du code du jeu dans layout.json), en version grise
(quadrillage de 1 m, une couleur par rôle) : une carte « squelette », éclairage précalculé.

Lancé par `npm run build-map -- dunes` (scripts/build-map.mjs), qui appelle Blender ainsi :
    blender --background --python map/dunes/build.py -- <dossier de sortie> <taille> <échantillons>
"""

import json
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

HALF = 36
# Direction du soleil (vers le soleil), la même que dans le ciel du jeu (src/world/sky.ts).
SUN_DIRECTION = (0.556, 0.742, 0.376)

kit.reset_scene(os.path.join(ROOT, 'public', 'textures'))
layout = json.load(open(os.path.join(HERE, 'layout.json')))

# Matériaux d'origine → version grise (le quadrillage suit le monde, à 1 m).
GREY = {
    'sand': 'greyFloor',
    'plaster': 'greyWall',
    'sandstone': 'greyRaised',
    'wood': 'greyOverhead',
    'crate': 'greyCover',
}


def essential(b):
    """
    Carte « squelette » : seulement ce qui compte pour jouer. Sans les objets posés (barils, arbres…,
    dont les collisions sont les blocs sans matériau), les fenêtres, et les bois décoratifs (palettes,
    battants de porte, auvents et leurs poteaux) ; on garde les poutres des linteaux (20 cm).
    """
    if b['material'] in (None, 'shadowGap'):
        return False
    return b['material'] != 'wood' or abs(b['max'][1] - b['min'][1] - 0.2) < 1e-3


carte = kit.Kit((-HALF, 0, -HALF), (HALF, 100, HALF))
def grey(b):
    """Couleur de rôle : le grès sert aussi à l'enceinte et au-dessus des passages, qui sont des murs."""
    if b['material'] == 'sandstone' and b['max'][1] >= 4.5:
        return 'greyWall'
    return GREY[b['material']]


for b in filter(essential, layout['boxes']):
    carte.box(b['min'], b['max'], grey(b), None, b['surface'])
obj = carte.build('dunes')


bake.setup_lighting(SUN_DIRECTION, 2.5, os.path.join(ROOT, 'public', 'sky', 'sky.hdr'), sky_irradiance=1.9)
density = bake.lightmap_uv(obj, SIZE)
image = bake.bake(obj, SIZE, SAMPLES)
os.makedirs(OUT, exist_ok=True)
scale = bake.save_lightmap(image, os.path.join(OUT, 'lightmap.png'))
bake.export_glb(obj, os.path.join(OUT, 'dunes.glb'))
bake.write_json(os.path.join(OUT, 'dunes.json'), {
    'lightmapScale': scale,
    'lightmapDensity': density,
    'materials': carte.materials_json(),
    'collisions': carte.collisions(),
    'props': [],
})
