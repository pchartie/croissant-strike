"""Soldats des bots : le mannequin de l'« Universal Animation Library » de Quaternius (CC0), habillé.

Le corps est coloré selon l'os qui porte chaque sommet (peau, chemise, gants, pantalon, bottes), et
l'équipement est ajouté par le script, collé aux os : gilet à poches et ceinture pour tous, casque pour
les CT, cagoule pour les T. Deux tenues sur le même squelette, dans un seul fichier, avec les seules
animations utiles au jeu. Une couleur par sommet (pas de texture) : un seul appel de dessin par soldat.

Lancé par `npm run build-characters` (scripts/build-characters.mjs) :
    blender --background --python characters/build.py -- <mannequin .glb> <sortie .glb>
"""

import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index('--') + 1:]
SOURCE, OUT = args[0], args[1]

# Animations gardées (noms du pack), et leur nom dans le jeu.
ANIMATIONS = {
    'Idle_Loop': 'idle',
    'Walk_Loop': 'walk',
    'Sprint_Loop': 'run',  # fait pour la vitesse des bots, et deux fois moins rebondissant que Jog_Fwd_Loop
    'Crouch_Idle_Loop': 'crouchIdle',
    'Crouch_Fwd_Loop': 'crouchWalk',
    'Pistol_Aim_Up': 'aimUp',
    'Pistol_Aim_Neutral': 'aim',
    'Pistol_Aim_Down': 'aimDown',
    'Pistol_Shoot': 'shoot',
    'Pistol_Reload': 'reload',
    'Death01': 'death',
}

# Tenues : couleur de chaque partie du corps (sRGB).
OUTFITS = {
    # T (coéquipiers) : tenue sable clair ; CT (ennemis) : bleu marine sombre. Les deux camps doivent se
    # distinguer d'un coup d'œil, au soleil comme à l'ombre : clarté opposée autant que teinte.
    'T': {'head': 0x2b2622, 'skin': 0xb48a68, 'shirt': 0xcdb07c, 'gloves': 0x3a3128, 'pants': 0xa98f63,
          'boots': 0x3b2f24, 'vest': 0x8a7650, 'pouch': 0x75633f, 'belt': 0x4d3f2c},
    'CT': {'head': 0x1c2027, 'skin': 0xb48a68, 'shirt': 0x2a3b57, 'gloves': 0x15181c, 'pants': 0x1f2a3d,
           'boots': 0x111316, 'vest': 0x161d29, 'pouch': 0x111720, 'belt': 0x0e1014, 'helmet': 0x1d2530},
}

# Os → partie du corps (le premier préfixe qui correspond).
REGIONS = [
    (('DEF-head', 'DEF-neck'), 'head'),
    (('DEF-hand', 'DEF-f_', 'DEF-thumb'), 'gloves'),
    (('DEF-foot', 'DEF-toe'), 'boots'),
    (('DEF-thigh', 'DEF-shin', 'DEF-hips'), 'pants'),
    (('DEF-spine', 'DEF-shoulder', 'DEF-upper_arm', 'DEF-forearm'), 'shirt'),
]


# Tissu de chaque partie, rangé dans l'alpha de la couleur des sommets : le jeu applique le motif
# correspondant (src/bots/BotModel.ts) : 0 sergé (vêtements, cagoule), 1/3 toile épaisse (gilet,
# ceinture), 2/3 cuir (gants, bottes), 1 lisse (casque, lunettes).
FABRIC = {'head': 0.0, 'skin': 0.0, 'shirt': 0.0, 'pants': 0.0, 'gloves': 2 / 3, 'boots': 2 / 3,
          'vest': 1 / 3, 'pouch': 1 / 3, 'belt': 1 / 3, 'helmet': 1.0, 'plain': 1.0}


def linear(hex_color, fabric=1.0):
    def channel(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(channel((hex_color >> shift) & 0xff) for shift in (16, 8, 0)) + (fabric,)


def region_of(bone):
    for prefixes, region in REGIONS:
        if bone.startswith(prefixes):
            return region
    return 'shirt'


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SOURCE)
armature = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
# Le corps est le maillage rattaché au squelette ; le reste (une forme d'affichage d'os) est retiré.
body = next(o for o in bpy.data.objects if o.type == 'MESH' and o.parent == armature)
for stray in [o for o in bpy.data.objects if o.type == 'MESH' and o is not body]:
    bpy.data.objects.remove(stray)
bones = armature.data.bones


def bone_point(name, t=0.0):
    """Point le long d'un os au repos (0 = tête, 1 = queue), en coordonnées du monde."""
    bone = bones[name]
    return armature.matrix_world @ bone.head_local.lerp(bone.tail_local, t)


# --- Corps : un sommet prend la couleur de l'os qui pèse le plus sur lui ---
bpy.context.view_layer.objects.active = body
body.select_set(True)
# Moins de triangles : un soldat est vu de loin la plupart du temps.
decimate = body.modifiers.new('moins', 'DECIMATE')
decimate.ratio = 0.55
bpy.ops.object.modifier_apply(modifier=decimate.name)
groups = {g.index: g.name for g in body.vertex_groups}
vertex_region = []
for v in body.data.vertices:
    best = max(v.groups, key=lambda g: g.weight, default=None)
    vertex_region.append(region_of(groups[best.group]) if best else 'shirt')


def make_soldier(team):
    """Copie du corps colorée pour la tenue `team`, plus son équipement, attachée au même squelette."""
    outfit = OUTFITS[team]
    mesh = body.data.copy()
    obj = bpy.data.objects.new(f'soldier_{team}', mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.matrix_world = body.matrix_world
    obj.parent = armature
    for group in body.vertex_groups:
        obj.vertex_groups.new(name=group.name)
    for v in body.data.vertices:
        for g in v.groups:
            obj.vertex_groups[groups[g.group]].add([v.index], g.weight, 'REPLACE')
    obj.modifiers.new('squelette', 'ARMATURE').object = armature

    colors = mesh.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    for loop in mesh.loops:
        region = vertex_region[loop.vertex_index]
        colors.data[loop.index].color = linear(outfit[region], FABRIC[region])

    gear = bmesh.new()
    color_layer = gear.loops.layers.float_color.new('Col')
    deform = gear.verts.layers.deform.new()
    bone_index = {}

    def bone_group(name):
        if name not in bone_index:
            group = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
            bone_index[name] = group.index
        return bone_index[name]

    def add_box(center, size, color, bone, rotation=Matrix.Identity(3), fabric=1 / 3):
        """Boîte rigide, collée à un os (poids 1)."""
        result = bmesh.ops.create_cube(gear, size=1.0)
        for v in result['verts']:
            v.co = center + rotation @ Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
            v[deform][bone_group(bone)] = 1.0
        faces = {f for v in result['verts'] for f in v.link_faces}
        for f in faces:
            for loop in f.loops:
                loop[color_layer] = linear(color, fabric)

    def add_dome(center, radius, color, bone, squash=0.85):
        """Demi-sphère (casque)."""
        result = bmesh.ops.create_uvsphere(gear, u_segments=12, v_segments=8, radius=radius)
        keep = []
        for v in result['verts']:
            # Bas aplati (le bord du casque), un peu plus long d'avant en arrière.
            v.co = center + Vector((v.co.x, v.co.y * 1.08, max(v.co.z, -radius * 0.25) * squash))
            v[deform][bone_group(bone)] = 1.0
            keep.append(v)
        for f in {f for v in keep for f in v.link_faces}:
            for loop in f.loops:
                loop[color_layer] = linear(color, FABRIC['helmet'])

    # Repères au repos (Blender : z vers le haut, -y vers l'avant du personnage).
    chest = bone_point('DEF-spine.003', 0.1)
    belly = bone_point('DEF-spine.001', 0.5)
    hips = bone_point('DEF-hips', 0.3)
    head = bone_point('DEF-head', 0.45)
    front = Vector((0, -1, 0))
    add_box(chest + Vector((0, 0.0, -0.04)), (0.38, 0.30, 0.34), outfit['vest'], 'DEF-spine.003')
    add_box(belly + Vector((0, 0.0, 0.0)), (0.36, 0.28, 0.16), outfit['vest'], 'DEF-spine.002')
    for dx in (-0.11, 0.0, 0.11):
        add_box(belly + front * 0.16 + Vector((dx, 0, 0.02)), (0.09, 0.06, 0.12), outfit['pouch'], 'DEF-spine.002')
    add_box(chest + front * 0.165 + Vector((0.08, 0, -0.02)), (0.1, 0.05, 0.1), outfit['pouch'], 'DEF-spine.003')
    add_box(hips + Vector((0, 0.0, 0.03)), (0.36, 0.25, 0.06), outfit['belt'], 'DEF-hips')
    # Le mannequin n'a pas de visage : cagoule pour tous (la tête est sombre), avec un bandeau aux yeux ;
    # les CT ont en plus un casque et des lunettes de protection.
    crown = bone_point('DEF-head', 0.75)
    if team == 'CT':
        add_dome(crown + Vector((0, 0.005, -0.01)), 0.15, outfit['helmet'], 'DEF-head', squash=0.9)
        add_box(head + front * 0.1 + Vector((0, 0, 0.02)), (0.17, 0.035, 0.05), 0x0e1012, 'DEF-head', fabric=FABRIC['plain'])
    else:
        add_box(head + front * 0.095 + Vector((0, 0, 0.02)), (0.15, 0.03, 0.035), 0x5a4a3a, 'DEF-head', fabric=0.0)

    gear_mesh = bpy.data.meshes.new(f'gear_{team}')
    gear.to_mesh(gear_mesh)
    gear.free()
    gear_obj = bpy.data.objects.new(f'gear_{team}', gear_mesh)
    bpy.context.scene.collection.objects.link(gear_obj)
    for group in obj.vertex_groups:
        gear_obj.vertex_groups.new(name=group.name)
    # Les poids ont été écrits par index de groupe : ils correspondent, les groupes étant créés dans le même ordre.
    bpy.ops.object.select_all(action='DESELECT')
    gear_obj.select_set(True)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.join()

    material = bpy.data.materials.new(f'tenue_{team}')
    material.use_nodes = True
    nodes = material.node_tree.nodes
    attribute = nodes.new('ShaderNodeVertexColor')
    attribute.layer_name = 'Col'
    bsdf = nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.85
    material.node_tree.links.new(attribute.outputs['Color'], bsdf.inputs['Base Color'])
    obj.data.materials.clear()
    obj.data.materials.append(material)
    return obj


soldiers = [make_soldier('T'), make_soldier('CT')]
bpy.data.objects.remove(body)

# --- Animations : seulement celles du jeu, renommées ---
for action in list(bpy.data.actions):
    name = action.name.split('|')[-1]
    if name in ANIMATIONS:
        action.name = ANIMATIONS[name]
    else:
        bpy.data.actions.remove(action)
print('[personnages] animations :', sorted(a.name for a in bpy.data.actions))

bpy.ops.object.select_all(action='DESELECT')
armature.select_set(True)
for obj in soldiers:
    obj.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    use_selection=True,
    export_yup=True,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_force_sampling=True,
    export_vertex_color='ACTIVE',
    export_all_vertex_colors=False,
    export_texcoords=False,
    export_image_format='NONE',
)
print('[personnages]', OUT)
