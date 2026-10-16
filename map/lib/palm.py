"""Palmiers (dattiers) faits de faces libres : tronc à 8 côtés, penché et effilé ; couronne de palmes en V
qui retombent. Ils font partie du maillage de la carte : éclairage précalculé, ombres dans la carte.

La texture des palmes (folioles sur une nervure, avec transparence) est dessinée ici et enregistrée dans
public/textures/palmLeaf.png : Blender et le jeu utilisent la même image.
"""

import math
import random

import numpy as np

TRUNK_SIDES = 8


def leaf_texture(path, width=256, length=1024):
    """Palme vue de dessus : nervure au centre, folioles inclinées vers la pointe (en bas de l'image)."""
    y, x = np.mgrid[0:length, 0:width].astype(np.float32)
    t = y / length  # 0 à la base de la palme, 1 à la pointe
    dx = np.abs(x - width / 2) / (width / 2)  # 0 sur la nervure, 1 au bord
    # Longueur des folioles : courte à la base, longue au milieu, nulle à la pointe.
    reach = np.clip(np.sin(np.pi * np.clip(t * 1.05, 0, 1)) ** 0.7, 0, 1) * np.where(t < 0.08, t / 0.08, 1)
    spacing = 18.0
    phase = (y - dx * width * 0.9) / spacing  # folioles inclinées vers la pointe
    frac = phase - np.floor(phase)
    leaflet = (np.abs(frac - 0.5) < 0.36) & (dx < reach)
    # Folioles un peu effilées au bout.
    leaflet &= np.abs(frac - 0.5) < 0.36 * (1.15 - dx / np.maximum(reach, 1e-3) * 0.5)
    rib = dx < 0.025 * (1.2 - t)
    alpha = (leaflet | rib).astype(np.float32)

    rng = np.random.default_rng(7)
    noise = rng.normal(0, 0.035, (length, width)).astype(np.float32)
    shade = 0.82 + 0.18 * (1 - dx) + noise - 0.12 * t
    green = np.stack([0.36 * shade, 0.48 * shade, 0.20 * shade], axis=-1)
    # Pointes des folioles un peu sèches, nervure jaunâtre.
    dry = np.clip((dx / np.maximum(reach, 1e-3) - 0.75) * 3, 0, 1)[..., None]
    green = green * (1 - dry) + np.array([0.62, 0.55, 0.30], dtype=np.float32) * shade[..., None] * dry
    color = np.where(rib[..., None], np.array([0.70, 0.62, 0.36], dtype=np.float32), green)
    rgba = np.concatenate([np.clip(color, 0, 1), alpha[..., None]], axis=-1)

    import bpy
    image = bpy.data.images.new('palmLeaf', width, length, alpha=True)
    image.colorspace_settings.name = 'sRGB'
    # Blender range les pixels du bas vers le haut : la base de la palme (t = 0) en haut de l'image.
    image.pixels.foreach_set(rgba[::-1].ravel())
    image.filepath_raw = path
    image.file_format = 'PNG'
    image.save()
    bpy.data.images.remove(image)


def add_palm(kit, x, z, height=7.0, seed=0, fronds=14, surface='wood'):
    """
    Palmier posé en (x, z) : tronc jusqu'à `height`, collision du tronc, couronne touffue de deux étages
    de `fronds` palmes : en haut, dressées ; en dessous, décalées d'un demi-pas et qui retombent.
    """
    rng = random.Random(seed)
    lean_angle = rng.uniform(0, 2 * math.pi)
    lean = rng.uniform(0.3, 0.9)
    segments = 9
    r0, r1 = 0.26, 0.17

    def center(t):
        # Le tronc penche de plus en plus en montant (courbe douce).
        d = lean * t * t
        return x + math.cos(lean_angle) * d, height * t, z + math.sin(lean_angle) * d

    circumference = 2 * math.pi * r0
    for k in range(segments):
        t0, t1 = k / segments, (k + 1) / segments
        (cx0, y0, cz0), (cx1, y1, cz1) = center(t0), center(t1)
        ra, rb = r0 + (r1 - r0) * t0, r0 + (r1 - r0) * t1
        for s in range(TRUNK_SIDES):
            a1, a2 = 2 * math.pi * s / TRUNK_SIDES, 2 * math.pi * (s + 1) / TRUNK_SIDES
            p = lambda cx, y, cz, r, a: (cx + r * math.cos(a), y, cz + r * math.sin(a))
            u1, u2 = s / TRUNK_SIDES * circumference, (s + 1) / TRUNK_SIDES * circumference
            # Vu de l'extérieur, dans le sens inverse des aiguilles (angle décroissant en bas).
            kit.face([p(cx0, y0, cz0, ra, a2), p(cx0, y0, cz0, ra, a1), p(cx1, y1, cz1, rb, a1), p(cx1, y1, cz1, rb, a2)],
                     'palmTrunk', [(u2, y0), (u1, y0), (u1, y1), (u2, y1)])
    kit.collision((x - 0.25, 0, z - 0.25), (x + 0.25, 2.6, z + 0.25), surface)

    top = center(1.0)
    below = center(0.97)
    for tier, (base, lifts, droop) in enumerate(((top, (25, 50), (30, 60)), (below, (0, 18), (40, 80)))):
        for i in range(fronds):
            yaw = 2 * math.pi * (i + 0.5 * tier) / fronds + rng.uniform(-0.15, 0.15)
            length = rng.uniform(2.6, 3.4)
            width = rng.uniform(0.9, 1.15)
            lift = rng.uniform(*lifts)
            fall = rng.uniform(*droop)
            _frond(kit, base, yaw, length, width, [lift, lift - fall * 0.45, lift - fall], rng.uniform(15, 30))


def _frond(kit, base, yaw, length, width, pitches, fold):
    """Palme : 3 tronçons qui retombent (`pitches`, degrés), deux moitiés relevées en V (`fold`, degrés)."""
    forward = lambda pitch: (math.cos(yaw) * math.cos(math.radians(pitch)), math.sin(math.radians(pitch)), math.sin(yaw) * math.cos(math.radians(pitch)))
    side = (-math.sin(yaw), 0.0, math.cos(yaw))
    up = (0.0, 1.0, 0.0)
    seg = length / len(pitches)
    point = base
    for k, pitch in enumerate(pitches):
        f = forward(pitch)
        nxt = tuple(point[i] + f[i] * seg for i in range(3))
        # Largeur : étroite à la base, pleine au milieu, réduite vers la pointe (la texture fait le reste).
        half = width / 2
        rise = half * math.sin(math.radians(fold))
        across = half * math.cos(math.radians(fold))
        v0, v1 = k / len(pitches), (k + 1) / len(pitches)
        for sgn, u_edge in ((1, 1.0), (-1, 0.0)):
            edge = lambda p: tuple(p[i] + side[i] * across * sgn + up[i] * rise for i in range(3))
            quad = [point, nxt, edge(nxt), edge(point)]
            uvs = [(0.5, 1 - v0), (0.5, 1 - v1), (u_edge, 1 - v1), (u_edge, 1 - v0)]
            if sgn < 0:
                quad.reverse()
                uvs.reverse()
            kit.face(quad, 'palmLeaf', uvs)
        point = nxt
