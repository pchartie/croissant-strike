# Prépare le Barrett M82 du « PSX Style Sniper Rifle Pack » (bigjigglydev) pour le jeu.
# Lancé par scripts/import-sniper.mjs : blender --background --python import-sniper.py -- <Barret.fbx> <dossier>
#
# Le FBX est en unités arbitraires (4,16 de long), canon vers +x, haut vers +z. On le ramène au repère des
# armes du Retro Weapon Pack : centimètres, canon vers +x, haut vers +y, origine sur la poignée.
import sys

import bpy
from mathutils import Matrix, Vector

source, out = sys.argv[sys.argv.index('--') + 1:][:2]

# Longueur réelle du M82 (1,45 m) et poignée (milieu, en unités du FBX) : l'endroit tenu par la main droite.
LENGTH_CM = 145.0
GRIP = Vector((-1.25, 0.0, -0.06))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=source)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in meshes:
    o.data.transform(o.matrix_world)
    o.matrix_world = Matrix.Identity(4)

# Une seule pièce : le fusil d'un sniper ne s'anime pas (la culasse du M82 est semi-automatique).
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
gun = bpy.context.view_layer.objects.active
gun.name = 'sniper'

xs = [v.co.x for v in gun.data.vertices]
scale = LENGTH_CM / (max(xs) - min(xs))
gun.data.transform(Matrix.Scale(scale, 4) @ Matrix.Translation(-GRIP))

# Bout du canon (cm, repère du jeu : y en haut) : le plus en avant, au milieu de la hauteur du canon.
tip = max(xs)
front = [v.co for v in gun.data.vertices if v.co.x > (tip - GRIP.x) * scale - 3]
muzzle = (max(v.x for v in front), (min(v.z for v in front) + max(v.z for v in front)) / 2)
print(f'[sniper] {len(gun.data.polygons)} faces, canon à x={muzzle[0]:.1f} cm, y={muzzle[1]:.1f} cm')

# Texture intégrée au FBX, enregistrée à part (le jeu l'applique lui-même, en pixels nets).
image = next(i for i in bpy.data.images if i.size[0] > 0)
image.filepath_raw = f'{out}/sniper-texture.png'
image.file_format = 'PNG'
image.save()

gun.data.materials.clear()
bpy.ops.export_scene.gltf(
    filepath=f'{out}/sniper.glb',
    use_selection=True,
    export_format='GLB',
    export_yup=True,
    export_materials='NONE',
    export_normals=True,
    export_texcoords=True,
    export_animations=False,
)
