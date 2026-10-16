"""Dunes : la carte d'origine (blocs exportés du code du jeu dans layout.json), éclairage précalculé.

Lancé par `npm run build-map -- dunes` (scripts/build-map.mjs), qui appelle Blender ainsi :
    blender --background --python map/dunes/build.py -- <dossier de sortie> <taille> <échantillons>
"""

import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(HERE, '..', 'lib'))

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import bake  # noqa: E402
import kit  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
SIZE = int(args[1]) if len(args) > 1 else 2048
SAMPLES = int(args[2]) if len(args) > 2 else 256

HALF = 36
# Direction du soleil (vers le soleil), la même que dans le ciel du jeu (src/world/sky.ts).
SUN_DIRECTION = (0.556, 0.742, 0.376)

# Objets posés (modèles Poly Haven bruts de .props-src) : seulement pour leurs ombres dans le calcul.
# Hauteur une fois posés, comme dans src/world/props.ts.
PROPS = {
    'barrelBlue': ('barrel_03', 0.9),
    'barrelRed': ('Barrel_01', 0.9),
    'jerrycan': ('metal_jerrycan', 0.46),
    'crate': ('plastic_crate_02', 0.25),
    'tree': ('quiver_tree_02', 5.0),
}

kit.reset_scene(os.path.join(ROOT, 'public', 'textures'))
layout = json.load(open(os.path.join(HERE, 'layout.json')))

carte = kit.Kit((-HALF, 0, -HALF), (HALF, 100, HALF))
for b in layout['boxes']:
    if b['material'] is None:
        continue  # collisions des objets : le jeu les pose lui-même avec les objets (props.ts)
    carte.box(b['min'], b['max'], b['material'], b.get('tile') or 1, b['surface'])
obj = carte.build('dunes')


def load_prop(source, height):
    """Importe un modèle, le recentre (base au sol) à la bonne hauteur ; renvoie ses objets maillages."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, '.props-src', source, f'{source}.gltf'))
    meshes = [o for o in set(bpy.data.objects) - before if o.type == 'MESH']
    bpy.context.view_layer.update()
    corners = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    scale = height / (hi.z - lo.z)
    fit = Matrix.Scale(scale, 4) @ Matrix.Translation(Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)))
    for o in meshes:
        o.matrix_world = fit @ o.matrix_world
        o.hide_render = True  # le modèle d'origine ne sert que de patron
    return meshes


templates = {}
for place in layout['props']:
    pid = place['id']
    if pid not in templates:
        templates[pid] = load_prop(*PROPS[pid])
    at = kit.to_blender((place['x'], place.get('y', 0), place['z']))
    placement = Matrix.Translation(at) @ Matrix.Rotation(math.radians(place.get('yaw', 0)), 4, 'Z')
    for template in templates[pid]:
        copy = template.copy()  # même maillage, autre position
        copy.matrix_world = placement @ template.matrix_world
        copy.hide_render = False
        bpy.context.scene.collection.objects.link(copy)

bake.setup_lighting(SUN_DIRECTION, 2.8, os.path.join(ROOT, 'public', 'sky', 'sky.hdr'), sky_irradiance=1.2)
density = bake.lightmap_uv(obj, SIZE)
image = bake.bake(obj, SIZE, SAMPLES)
os.makedirs(OUT, exist_ok=True)
scale = bake.save_lightmap(image, os.path.join(OUT, 'lightmap.png'))
bake.export_glb(obj, os.path.join(OUT, 'dunes.glb'))
bake.write_json(os.path.join(OUT, 'dunes.json'), {
    'lightmapScale': scale,
    'lightmapDensity': density,
    'collisions': carte.collisions(),
    'props': layout['props'],
})
