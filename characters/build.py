"""Soldats des bots : le mannequin de l'« Universal Animation Library » de Quaternius (CC0), habillé.

Le corps est coloré selon l'os qui porte chaque sommet (peau, chemise, gants, pantalon, bottes). Le gros
de l'équipement est taillé dans la peau du mannequin, gonflée : gilet porte-plaques, ceinture, casque des
CT, chèche des T ; il garde les poids des os et se plie avec le corps. S'y ajoutent des pièces collées aux
os : poches, radio, fente des yeux de la cagoule, yeux, lunettes des CT. Deux tenues sur le même squelette, dans un seul fichier, avec les seules
animations utiles au jeu. Une couleur par sommet (pas de texture) : un seul appel de dessin par soldat.

Lancé par `npm run build-characters` (scripts/build-characters.mjs) :
    blender --background --python characters/build.py -- <mannequin .glb> <sortie .glb>
"""

import math
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
    # Le gilet tranche sur la chemise (plus sombre, autre teinte) : il se lit comme de l'équipement.
    'T': {'head': 0x2b2622, 'skin': 0xb48a68, 'shirt': 0xcdb07c, 'gloves': 0x3a3128, 'pants': 0xa98f63,
          'boots': 0x3b2f24, 'vest': 0x5f5136, 'pouch': 0x4c4129, 'belt': 0x3a3022},
    'CT': {'head': 0x1c2027, 'skin': 0xb48a68, 'shirt': 0x2a3b57, 'gloves': 0x15181c, 'pants': 0x1f2a3d,
           'boots': 0x111316, 'vest': 0x2a2d31, 'pouch': 0x1f2225, 'belt': 0x141517, 'helmet': 0x3f4a3b},
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
vertex_bone = []
for v in body.data.vertices:
    best = max(v.groups, key=lambda g: g.weight, default=None)
    vertex_bone.append(groups[best.group] if best else '')
    vertex_region.append(region_of(vertex_bone[-1]) if best else 'shirt')
# Positions au repos dans le monde (z vers le haut, -y vers l'avant), pour choisir les zones.
vertex_world = [body.matrix_world @ v.co for v in body.data.vertices]


def surface_y(x_max, z_min, z_max, bones):
    """Avant du corps (y le plus petit) dans une tranche, pour poser ce qui s'y accroche."""
    return min(w.y for w, b in zip(vertex_world, vertex_bone)
               if abs(w.x) < x_max and z_min < w.z < z_max and b.startswith(bones))


def shell(team_obj, name, keep, offset, thickness, color, fabric, extra=None, touching=False, shape=None):
    """
    Pièce d'équipement qui épouse le corps : la peau des sommets `keep` (index -> vrai), gonflée
    de `offset` m le long des normales (plus `extra(sommet)`), avec une épaisseur. Elle garde les
    poids des os du corps, donc se plie avec lui (gilet, ceinture, casque, cagoule). `touching` :
    garder aussi les faces dont un seul sommet est retenu (bandes étroites : yeux, sangle).
    `shape(sommets)` : retouche finale des positions (coordonnées du monde), avant l'épaisseur.
    """
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    test = any if touching else all
    drop = [f for f in bm.faces if not test(keep(v.index) for v in f.verts)]
    bmesh.ops.delete(bm, geom=drop, context='FACES_ONLY')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.transform(bm, matrix=body.matrix_world, verts=bm.verts)
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * (offset + (extra(v) if extra else 0.0))
    if shape:
        shape(bm.verts)
        bm.normal_update()
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    for group in body.vertex_groups:
        obj.vertex_groups.new(name=group.name)
    if thickness:
        solid = obj.modifiers.new('epaisseur', 'SOLIDIFY')
        solid.thickness = thickness
        solid.offset = -1
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=solid.name)
    colors = obj.data.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    for loop in obj.data.loops:
        colors.data[loop.index].color = linear(color, fabric)
    return obj


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

    def add_dome(center, radius, color, bone, squash=0.85, full=False, fabric=FABRIC['plain']):
        """Sphère aplatie (yeux, verres de lunettes), ou demi-sphère si `full` est faux."""
        result = bmesh.ops.create_uvsphere(gear, u_segments=10, v_segments=6, radius=radius)
        keep = []
        for v in result['verts']:
            z = v.co.z if full else max(v.co.z, -radius * 0.25)
            v.co = center + Vector((v.co.x, v.co.y * squash, z))
            v[deform][bone_group(bone)] = 1.0
            keep.append(v)
        for f in {f for v in keep for f in v.link_faces}:
            for loop in f.loops:
                loop[color_layer] = linear(color, fabric)

    def add_arc(a, b, start, end, z_low, z_high, color, bone, segments=10):
        """Bande courbe sur le devant d'une ellipse (a : demi-largeur, b : demi-profondeur)."""
        columns = []
        for k in range(segments + 1):
            angle = start + (end - start) * k / segments
            x, y = a * math.sin(angle), -b * math.cos(angle)
            column = [gear.verts.new((x, y, z)) for z in (z_low, z_high)]
            for v in column:
                v[deform][bone_group(bone)] = 1.0
            columns.append(column)
        for left, right in zip(columns, columns[1:]):
            face = gear.faces.new((left[0], right[0], right[1], left[1]))
            for loop in face.loops:
                loop[color_layer] = linear(color, FABRIC['plain'])

    # Repères au repos (Blender : z vers le haut, -y vers l'avant du personnage).
    world = vertex_world
    bone_of = vertex_bone
    torso = ('DEF-spine.001', 'DEF-spine.002', 'DEF-spine.003')
    pieces = []

    # Gilet porte-plaques : la peau du torse (bras, cou et tête exclus), gonflée, avec une plaque
    # avant et une plaque arrière plates (elles effacent les pectoraux du mannequin).
    limbs = ('DEF-upper_arm', 'DEF-forearm', 'DEF-hand', 'DEF-f_', 'DEF-thumb', 'DEF-neck', 'DEF-head')

    def in_vest(i):
        return not bone_of[i].startswith(limbs) and 1.07 < world[i].z < 1.43 and abs(world[i].x) < 0.17

    def plates(verts):
        for side in (-1, 1):  # -1 : devant, 1 : dos
            facing_side = [v for v in verts if side * v.normal.y > 0.35]
            if not facing_side:
                continue
            outer = max(side * v.co.y for v in facing_side)
            for v in facing_side:
                # Plaque presque plate, un peu galbée sur les côtés ; fondue vers les flancs.
                blend = 1.0 - min(1.0, max(0.0, (abs(v.co.x) - 0.11) / 0.05))
                target = side * (outer - 1.6 * v.co.x ** 2)
                v.co.y += (target - v.co.y) * blend

    pieces.append(shell(obj, f'gilet_{team}', in_vest, 0.016, 0.012, outfit['vest'], FABRIC['vest'], shape=plates))
    # Ceinture autour des hanches.
    pieces.append(shell(obj, f'ceinture_{team}', lambda i: bone_of[i].startswith(('DEF-hips', 'DEF-spine.001')) and 0.985 < world[i].z < 1.045,
                        0.014, 0.008, outfit['belt'], FABRIC['belt']))

    # Poches plates sur le devant du gilet, une radio sur la poitrine, posées sur la plaque.
    front = surface_y(0.06, 1.1, 1.16, torso) - 0.03
    for dx in (-0.075, 0.0, 0.075):
        add_box(Vector((dx, front - 0.012, 1.13)), (0.066, 0.026, 0.075), outfit['pouch'], 'DEF-spine.002')
        add_box(Vector((dx, front - 0.026, 1.165)), (0.068, 0.006, 0.02), outfit['pouch'], 'DEF-spine.002')
    chest = surface_y(0.1, 1.3, 1.36, torso) - 0.03
    add_box(Vector((0.075, chest - 0.01, 1.33)), (0.05, 0.022, 0.07), outfit['pouch'], 'DEF-spine.003')
    add_box(Vector((0.087, chest - 0.012, 1.385)), (0.006, 0.006, 0.05), 0x15171a, 'DEF-spine.003', fabric=FABRIC['plain'])

    # Tête : cagoule (la tête sombre du mannequin), ouverture des yeux couleur peau, deux yeux.
    head_bone = lambda i: bone_of[i].startswith(('DEF-head', 'DEF-neck'))
    # Le visage du mannequin est trop grossier pour y découper une fente : bande courbe dessinée
    # sur le devant de la tête (ellipse de 9 cm de demi-largeur, 12 cm de profondeur), et deux yeux.
    face_a, face_b, eyes_z = 0.091, 0.121, 1.7
    add_arc(face_a, face_b, -0.85, 0.85, eyes_z - 0.012, eyes_z + 0.012, outfit['skin'], 'DEF-head')
    for angle in (-0.33, 0.33):
        add_dome(Vector((face_a * math.sin(angle), -face_b * math.cos(angle) - 0.002, eyes_z)), 0.0075, 0x111214, 'DEF-head', squash=0.6, full=True)
    if team == 'CT':
        # Casque qui épouse le crâne, jusqu'au-dessus des oreilles, avec un rebord et des lunettes.
        pieces.append(shell(obj, 'casque_CT', lambda i: head_bone(i) and (world[i].z > 1.735 or (world[i].z > 1.69 and world[i].y > 0.02)),
                            0.022, 0.01, outfit['helmet'], FABRIC['helmet']))
        pieces.append(shell(obj, 'rebord_CT', lambda i: head_bone(i) and 1.728 < world[i].z < 1.742,
                            0.034, 0.006, 0x14191f, FABRIC['helmet'], touching=True))
        pieces.append(shell(obj, 'sangle_CT', lambda i: head_bone(i) and 1.752 < world[i].z < 1.768,
                            0.034, 0.003, 0x0e1012, FABRIC['plain'], touching=True))
        forehead = -0.1 - 0.04
        for dx in (-0.032, 0.032):
            add_dome(Vector((dx, forehead, 1.765)), 0.018, 0x41697c, 'DEF-head', squash=0.55, full=True, fabric=FABRIC['plain'])
    else:
        # Foulard (chèche) autour du cou.
        pieces.append(shell(obj, 'cheche_T', lambda i: bone_of[i].startswith(('DEF-neck', 'DEF-spine.003')) and 1.45 < world[i].z < 1.57,
                            0.014, 0.01, 0x7d6a4c, FABRIC['shirt']))

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
    for piece in pieces:
        piece.select_set(True)
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
