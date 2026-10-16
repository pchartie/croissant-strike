"""Objets posés sur une carte (modèles Poly Haven, voir src/world/props.ts) : dans Blender, ils ne servent
qu'à projeter leurs ombres dans l'éclairage précalculé. Le jeu les dessine lui-même (un appel par modèle).
"""

import math
import os

import bpy
from mathutils import Matrix, Vector

from kit import to_blender

# Objet du jeu → (modèle brut dans .props-src, hauteur une fois posé), comme SPECS dans src/world/props.ts.
MODELS = {
    'barrelBlue': ('barrel_03', 0.9),
    'barrelRed': ('Barrel_01', 0.9),
    'jerrycan': ('metal_jerrycan', 0.46),
    'crate': ('plastic_crate_02', 0.25),
    'coveredCar': ('covered_car', 1.41),
    'aircon': ('exterior_aircon_unit', 0.93),
    'clayPot': ('planter_pot_clay', 0.55),
    'pottedPlant': ('potted_plant_01', 1.35),
    'jug': ('ceramic_vase_04', 0.7),
    'plasticChair': ('plastic_monobloc_chair_01', 0.88),
    'cafeTable': ('painted_wooden_table', 0.75),
    'trashCan': ('metal_trash_can', 0.91),
    'lantern': ('Lantern_01', 0.45),
}


def _load(root, source, height):
    """Importe un modèle, le recentre (base au sol) à la bonne hauteur ; renvoie ses objets maillages."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(root, '.props-src', source, f'{source}.gltf'))
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


def place(root, placements):
    """Pose les objets ({id, x, z, y?, yaw?} en coordonnées du jeu) pour le calcul de l'éclairage."""
    templates = {}
    for spot in placements:
        pid = spot['id']
        if pid not in templates:
            templates[pid] = _load(root, *MODELS[pid])
        at = to_blender((spot['x'], spot.get('y', 0), spot['z']))
        # Lacet du jeu (autour de y vers le haut) = rotation autour de z dans Blender.
        placement = Matrix.Translation(at) @ Matrix.Rotation(math.radians(spot.get('yaw', 0)), 4, 'Z')
        for template in templates[pid]:
            copy = template.copy()  # même maillage, autre position
            copy.matrix_world = placement @ template.matrix_world
            copy.hide_render = False
            bpy.context.scene.collection.objects.link(copy)
