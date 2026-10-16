"""Éclairage précalculé : carte d'éclairage (UV 1), soleil et ciel, calcul Cycles, export.

La carte d'éclairage enregistre la lumière reçue par chaque point des surfaces (soleil, ciel et
rebonds), sans leur couleur : dans le jeu, couleur de la texture × éclairage. Elle est stockée en
8 bits sRGB, divisée par `scale` (noté dans le JSON de la carte) pour garder de la précision dans
les ombres.
"""

import json
import math

import bpy
import numpy as np
from mathutils import Vector

from kit import to_blender


# --- Coordonnées de la carte d'éclairage ---

def lightmap_uv(obj, size, padding=3):
    """
    Range chaque face (des rectangles : la carte est faite de blocs) dans l'image, toutes avec la
    même densité de pixels par mètre, la plus grande possible. Les rectangles sont alignés sur les
    pixels et entourés de `padding` pixels, que le calcul remplit en débordant (margin).
    Renvoie la densité obtenue (pixels par mètre).
    """
    mesh = obj.data
    layer = mesh.uv_layers.new(name='lightmap')
    rects = []
    for poly in mesh.polygons:
        v = [mesh.vertices[mesh.loops[i].vertex_index].co for i in poly.loop_indices]
        rects.append((poly.index, (v[1] - v[0]).length, (v[3] - v[0]).length))

    def pack(density):
        """Rangement par étagères ; None si ça ne rentre pas."""
        items = []
        for index, w, h in rects:
            pw = max(1, math.ceil(w * density)) + 2 * padding
            ph = max(1, math.ceil(h * density)) + 2 * padding
            rotated = ph > pw
            items.append((index, pw, ph, rotated) if not rotated else (index, ph, pw, rotated))
        items.sort(key=lambda it: -it[2])
        x = y = shelf = 0
        placed = {}
        for index, pw, ph, rotated in items:
            if pw > size:
                return None
            if x + pw > size:
                x, y, shelf = 0, y + shelf, 0
            if y + ph > size:
                return None
            placed[index] = (x, y, pw, ph, rotated)
            x += pw
            shelf = max(shelf, ph)
        return placed

    lo, hi = 1.0, 200.0
    best = None
    for _ in range(30):
        mid = (lo + hi) / 2
        result = pack(mid)
        if result:
            lo, best = mid, result
        else:
            hi = mid
    density = lo
    for poly in mesh.polygons:
        x, y, pw, ph, rotated = best[poly.index]
        # Coins dans l'ordre des sommets : (0,0), (1,0), (1,1), (0,1) le long des côtés de la face.
        corners = [(0, 0), (1, 0), (1, 1), (0, 1)]
        for k, loop in enumerate(poly.loop_indices):
            a, b = corners[k]
            if rotated:
                a, b = b, a
            u = (x + padding + a * (pw - 2 * padding)) / size
            v = (y + padding + b * (ph - 2 * padding)) / size
            layer.data[loop].uv = (u, v)
    fill = sum(pw * ph for _, _, pw, ph, _ in best.values()) / size**2
    print(f'[bake] carte d\'éclairage {size}² : {density:.1f} pixels par mètre, remplie à {fill:.0%}')
    return density


# --- Lumière ---

def setup_lighting(sun_direction, sun_strength, sky_path, sky_irradiance, sky_clamp=3.0):
    """
    Soleil dans la direction donnée (coordonnées du jeu, vers le soleil) et ciel HDR, réglé pour
    qu'un sol à découvert reçoive `sky_irradiance` du ciel seul. Les pixels du soleil dans l'image
    sont plafonnés (`sky_clamp`) : le soleil, c'est la lampe, sinon il compterait deux fois.
    """
    scene = bpy.context.scene
    toward = to_blender(sun_direction).normalized()
    sun_data = bpy.data.lights.new('soleil', 'SUN')
    sun_data.energy = sun_strength
    sun_data.angle = math.radians(1.5)
    sun = bpy.data.objects.new('soleil', sun_data)
    sun.rotation_euler = (-toward).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(sun)

    world = bpy.data.worlds.new('ciel')
    scene.world = world
    world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    background = nodes['Background']
    env = nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(sky_path)
    clamp = nodes.new('ShaderNodeVectorMath')
    clamp.operation = 'MINIMUM'
    clamp.inputs[1].default_value = (sky_clamp,) * 3
    links.new(env.outputs['Color'], clamp.inputs[0])
    links.new(clamp.outputs['Vector'], background.inputs['Color'])

    # Lumière reçue par un sol horizontal sous ce ciel (image équirectangulaire, plafonnée).
    image = env.image
    w, h = image.size
    pixels = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    rgb = np.minimum(pixels.reshape(h, w, 4)[:, :, :3], sky_clamp)
    luminance = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    latitude = (np.arange(h) + 0.5) / h * math.pi - math.pi / 2  # rangée 0 = bas de l'image
    weight = np.where(latitude > 0, np.sin(latitude) * np.cos(latitude), 0) * (math.pi / h) * (2 * math.pi / w)
    irradiance = float((luminance.sum(axis=1) * weight).sum())
    background.inputs['Strength'].default_value = sky_irradiance / irradiance
    print(f'[bake] ciel : {irradiance:.2f} reçu brut, intensité {sky_irradiance / irradiance:.3f}')


# --- Calcul ---

def bake(obj, size, samples, bounces=4):
    """Calcule l'éclairage diffus (direct + rebonds, sans la couleur) dans une image flottante."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = bounces
    scene.cycles.diffuse_bounces = bounces
    scene.cycles.glossy_bounces = 0
    scene.cycles.transparent_max_bounces = 8
    scene.render.bake.margin = 4
    scene.render.bake.margin_type = 'EXTEND'

    image = bpy.data.images.new('lightmap', size, size, float_buffer=True, alpha=False)
    for mat in obj.data.materials:
        node = mat.node_tree.nodes.new('ShaderNodeTexImage')
        node.image = image
        mat.node_tree.nodes.active = node
    obj.data.uv_layers['lightmap'].active = True

    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, use_clear=True, margin=4)

    # Les nœuds de calcul ne doivent pas partir dans l'export.
    for mat in obj.data.materials:
        mat.node_tree.nodes.remove(mat.node_tree.nodes.active)
    obj.data.uv_layers['uv0'].active = True
    return image


def save_lightmap(image, path):
    """Enregistre en PNG 8 bits sRGB, divisé par une échelle choisie sur les valeurs hautes. Renvoie l'échelle."""
    w, h = image.size
    pixels = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape(-1, 4)
    rgb = pixels[:, :3]
    scale = float(np.percentile(rgb.max(axis=1), 99.9)) * 1.05
    x = np.clip(rgb / scale, 0, 1)
    srgb = np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)
    out = bpy.data.images.new('lightmap_8bit', w, h, alpha=False)
    out.colorspace_settings.name = 'Non-Color'
    out.pixels.foreach_set(np.concatenate([srgb, np.ones((len(srgb), 1), dtype=np.float32)], axis=1).ravel())
    out.filepath_raw = path
    out.file_format = 'PNG'
    out.save()
    print(f'[bake] {path} (échelle {scale:.3f})')
    return scale


# --- Export ---

def export_glb(obj, path):
    """Le maillage seul (matériaux nommés, sans images), UV 0 et UV 1, en y vers le haut."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_image_format='NONE',
        export_apply=True,
    )


def write_json(path, data):
    with open(path, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
