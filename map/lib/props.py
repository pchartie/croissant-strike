"""Objets posés sur une carte (modèles Poly Haven, voir src/world/props.ts) : dans Blender, ils ne servent
qu'à projeter leurs ombres dans l'éclairage précalculé. Le jeu les dessine lui-même (un appel par modèle).
"""

import math
import os

import bpy
from mathutils import Matrix, Vector

from kit import to_blender

# Objet du jeu → (modèle brut dans .props-src, hauteur une fois posé, emprise au sol largeur × profondeur),
# comme SPECS dans src/world/props.ts.
MODELS = {
    'barrelBlue': ('barrel_03', 0.9, (0.61, 0.62)),
    'barrelRed': ('Barrel_01', 0.9, (0.58, 0.58)),
    'jerrycan': ('metal_jerrycan', 0.46, (0.35, 0.17)),
    'crate': ('plastic_crate_02', 0.25, (0.51, 0.41)),
    'coveredCar': ('covered_car', 1.41, (1.79, 4.38)),
    'aircon': ('exterior_aircon_unit', 0.93, (1.8, 0.38)),
    'clayPot': ('planter_pot_clay', 0.55, (0.65, 0.65)),
    'pottedPlant': ('potted_plant_01', 1.35, (0.59, 0.63)),
    'jug': ('ceramic_vase_04', 0.7, (0.37, 0.37)),
    'plasticChair': ('plastic_monobloc_chair_01', 0.88, (0.64, 0.63)),
    'cafeTable': ('painted_wooden_table', 0.75, (1.87, 0.89)),
    'trashCan': ('metal_trash_can', 0.91, (1.78, 0.56)),
    'lantern': ('Lantern_01', 0.45, (0.19, 0.16)),
}


# Objets ronds : leur emprise ne grossit pas quand on les tourne, et deux d'entre eux se touchent selon
# la distance entre leurs centres.
ROUND = {'barrelBlue', 'barrelRed', 'clayPot', 'pottedPlant', 'jug'}


def footprint(spot):
    """Boîte (x1, y1, z1, x2, y2, z2) d'un objet posé, tourné."""
    _, height, (w, d) = MODELS[spot['id']]
    yaw = 0 if spot['id'] in ROUND else math.radians(spot.get('yaw', 0))
    c, s = abs(math.cos(yaw)), abs(math.sin(yaw))
    hx, hz = (w * c + d * s) / 2, (w * s + d * c) / 2
    y = spot.get('y', 0)
    return (spot['x'] - hx, y, spot['z'] - hz, spot['x'] + hx, y + height, spot['z'] + hz)


def check_overlaps(placements, tolerance=0.02):
    """Signale les objets qui se chevauchent (une voiture posée sur un pot de fleurs…)."""
    boxes = [(spot, footprint(spot)) for spot in placements]
    found = 0
    for i, (a, ba) in enumerate(boxes):
        for b, bb in boxes[i + 1:]:
            if a['id'] in ROUND and b['id'] in ROUND:
                ra, rb = max(MODELS[a['id']][2]) / 2, max(MODELS[b['id']][2]) / 2
                apart = math.hypot(a['x'] - b['x'], a['z'] - b['z']) + tolerance >= ra + rb
                if apart or ba[1] >= bb[4] or bb[1] >= ba[4]:
                    continue
            elif not all(ba[k] + tolerance < bb[k + 3] and bb[k] + tolerance < ba[k + 3] for k in range(3)):
                continue
            # Un objet posé sur un autre (lanterne sur la table) n'est pas un chevauchement.
            if abs(ba[1] - bb[4]) < 0.05 or abs(bb[1] - ba[4]) < 0.05:
                continue
            found += 1
            print(f"[props] chevauchement : {a['id']} ({a['x']}, {a['z']}) et {b['id']} ({b['x']}, {b['z']})")
    print(f'[props] {len(placements)} objets, {found} chevauchement(s)')


def _load(root, source, height):
    """Importe un modèle, le recentre (base au sol) à la bonne hauteur ; renvoie ses objets maillages."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(root, '.props-src', source, f'{source}.gltf'))
    meshes = [o for o in set(bpy.data.objects) - before if o.type == 'MESH']
    bpy.context.view_layer.update()
    # Sur les sommets : la boîte d'un morceau tourné serait trop grande (comme fitMatrix dans props.ts).
    corners = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
    lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    scale = height / (hi.z - lo.z)
    fit = Matrix.Scale(scale, 4) @ Matrix.Translation(Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)))
    for o in meshes:
        o.matrix_world = fit @ o.matrix_world
        o.hide_render = True  # le modèle d'origine ne sert que de patron
    return meshes


def place(root, placements):
    """Pose les objets ({id, x, z, y?, yaw?} en coordonnées du jeu) pour le calcul de l'éclairage."""
    templates = {}
    for spot in placements:
        pid = spot['id']
        if pid not in templates:
            templates[pid] = _load(root, *MODELS[pid][:2])
        at = to_blender((spot['x'], spot.get('y', 0), spot['z']))
        # Lacet du jeu (autour de y vers le haut) = rotation autour de z dans Blender.
        placement = Matrix.Translation(at) @ Matrix.Rotation(math.radians(spot.get('yaw', 0)), 4, 'Z')
        for template in templates[pid]:
            copy = template.copy()  # même maillage, autre position
            copy.matrix_world = placement @ template.matrix_world
            copy.hide_render = False
            bpy.context.scene.collection.objects.link(copy)
