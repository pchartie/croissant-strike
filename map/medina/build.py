"""Médina : vieille ville du Maghreb, trois voies et deux sites (plan : voir le README, section Cartes).

Les zones jouables du plan, des maisons partout ailleurs (crépis de plusieurs teintes, soubassement,
corniche, fenêtres à volets, portes), les sols de chaque zone, les portes, l'arche, la terrasse A, la
passerelle, le souk sous ses toiles, la fontaine, le puits, le minaret et des palmiers ; éclairage précalculé.

Lancé par `npm run build-map -- medina`, qui appelle Blender ainsi :
    blender --background --python map/medina/build.py -- <dossier de sortie> <taille> <échantillons>

Coordonnées du jeu, en mètres : x vers l'est, y vers le haut, z vers le sud (le nord est en -z).
"""

import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(HERE, '..', 'lib'))

import bake  # noqa: E402
import kit  # noqa: E402
import decals  # noqa: E402
import palm  # noqa: E402
import props  # noqa: E402
from mathutils import Vector  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
SIZE = int(args[1]) if len(args) > 1 else 2048
SAMPLES = int(args[2]) if len(args) > 2 else 256

# Limites de la carte (doivent correspondre à src/world/maps.ts).
X0, X1, Z0, Z1 = -40, 40, -46, 46
SUN_DIRECTION = (0.556, 0.742, 0.376)
TEXTURES = os.path.join(ROOT, 'public', 'textures')

# Hauteurs
A_HEIGHT = 1.2  # terrasse A et passerelle
DOOR = 3.0  # dessous des linteaux
WALL = 5.0  # murs en travers des rues (portes)
BIG, SMALL = 1.6, 0.9  # caisses, comme dans CS (la grosse se monte accroupi en sautant)

# Zones jouables (x1, z1, x2, z2) et leur sol : tout le reste est bâti. Ne pas changer le tracé sans
# refaire jouer la carte (il a été validé en version grise).
ZONES = [
    ((-10, 34, 10, 46), 'packedSand'),  # spawn T (place des potiers)
    ((-40, 36, -10, 44), 'cobble'),  # cour ouest, vers les Portes longues
    ((10, 36, 30, 44), 'cobble'),  # cour est, vers le souk
    ((-40, -14, -30, 36), 'cobble'),  # Longue
    ((-30, 8, -26, 14), 'cobble'),  # Coin
    ((-40, -34, -10, -14), 'paving'),  # site A (terrasse)
    ((-14, -14, -10, 0), 'paving'),  # passerelle
    ((-14, 0, -10, 6), 'cobble'),  # pied de l'escalier de la passerelle
    ((-5, 6, 5, 34), 'cobble'),  # Milieu (rue)
    ((-10, -10, 10, 6), 'packedSand'),  # place du Milieu
    ((-6, -34, 6, -10), 'cobble'),  # couloir des Portes CT
    ((-24, -46, 24, -34), 'paving'),  # spawn CT (esplanade)
    ((10, -6, 18, -1), 'cobble'),  # Ruelle
    ((18, -34, 40, 6), 'stoneTiles'),  # site B (cour de la fontaine)
    ((22, 6, 30, 36), 'packedSand'),  # Souk
]
WALKABLE = [rect for rect, _ in ZONES]
RAISED = {5, 6}  # terrasse A et passerelle
SOUK = 14
SURFACE = {'packedSand': 'sand', 'cobble': 'stone', 'paving': 'stone', 'stoneTiles': 'stone'}
# Objets posés (src/world/props.ts) : {id, x, z, y?, yaw?}. Le jeu les dessine ; ici, ils font leurs ombres.
PROPS = []


def prop(pid, x, z, yaw=0, y=0.0):
    PROPS.append({'id': pid, 'x': x, 'z': z, 'y': y, 'yaw': yaw})


kit.reset_scene(TEXTURES)
carte = kit.Kit((X0, 0, Z0), (X1, 100, Z1))


def box(x1, z1, x2, z2, y1, y2, material, surface='stone', top=True, solid=True, tile=None, keep=False):
    carte.box((x1, y1, z1), (x2, y2, z2), material, tile, surface, solid=solid, top=top, keep=keep)


def crate(x, z, size=BIG, y=0.0):
    box(x - size / 2, z - size / 2, x + size / 2, z + size / 2, y, y + size, 'crate', 'wood', tile=size)


def zone_at(x, z):
    for i, (x1, z1, x2, z2) in enumerate(WALKABLE):
        if x1 <= x <= x2 and z1 <= z <= z2:
            return i
    return None


def oriented(corners, want):
    """Remet les coins dans l'ordre qui fait regarder la face dans la direction `want` (jeu)."""
    a, b, d = (Vector(corners[i]) for i in (0, 1, -1))
    normal = (b - a).cross(d - a)
    return corners if normal.dot(Vector(want)) > 0 else corners[::-1]


# --- Sols ---
for (x1, z1, x2, z2), floor in ZONES:
    box(x1, z1, x2, z2, -1, 0, floor, SURFACE[floor])


# --- Maisons ---
CLAYS = ['clayOchre'] * 5 + ['clayWhite'] * 3 + ['clayPink'] * 2 + ['clayRed'] * 2
FACADES = []  # (x1, z1, x2, z2, hauteur, graine) : murs dont on habille les côtés tournés vers une rue


def house(x1, z1, x2, z2):
    rng = random.Random(f'{x1},{z1},{x2},{z2}')
    height = rng.choice([5.0, 5.5, 6.0, 6.5, 7.0, 7.5])
    material = rng.choice(CLAYS)
    box(x1, z1, x2, z2, 0, height, material, 'plaster', top=False)
    FACADES.append((x1, z1, x2, z2, height, rng.random()))


carte.fill_buildings(WALKABLE, house, max_size=7)
# Enceinte : une rangée de maisons hors de la carte (1 m d'épaisseur), plus hautes que les autres.
for x1, z1, x2, z2 in ((X0 - 1, Z0 - 1, X0, Z1 + 1), (X1, Z0 - 1, X1 + 1, Z1 + 1), (X0, Z0 - 1, X1, Z0), (X0, Z1, X1, Z1 + 1)):
    for px1, px2 in kit._pieces(x1, x2, 7):
        for pz1, pz2 in kit._pieces(z1, z2, 7):
            rng = random.Random(f'enceinte {px1},{pz1}')
            height = rng.choice([7.5, 8.0, 8.5, 9.0, 9.5])
            box(px1, pz1, px2, pz2, 0, height, rng.choice(CLAYS), 'plaster', top=False)
            FACADES.append((px1, pz1, px2, pz2, height, rng.random()))


def relief(side, at, a, b, y1, y2, depth, material):
    """Décor collé sur une façade (sans collision) : de `a` à `b` le long du mur, de `y1` à `y2`."""
    if side == 'x+':
        box(at, a, at + depth, b, y1, y2, material, solid=False)
    elif side == 'x-':
        box(at - depth, a, at, b, y1, y2, material, solid=False)
    elif side == 'z+':
        box(a, at, b, at + depth, y1, y2, material, solid=False)
    else:
        box(a, at - depth, b, at, y1, y2, material, solid=False)


# Côté d'une façade → (normale vers la rue, direction « vers la droite » vue de la rue).
FACING = {'x+': ((1, 0, 0), (0, 0, -1)), 'x-': ((-1, 0, 0), (0, 0, 1)), 'z+': ((0, 0, 1), (1, 0, 0)), 'z-': ((0, 0, -1), (-1, 0, 0))}


def decal(side, at, a, b, y1, y2, material, u=(0.0, 1.0), offset=0.01):
    """
    Image plaquée sur une façade, de `a` à `b` le long du mur et de `y1` à `y2` ; `u` = partie de
    l'image en largeur (affiches côte à côte), dans le sens de lecture vu de la rue.
    """
    normal, right = FACING[side]
    plane = at + offset * (normal[0] + normal[2])
    def point(t, y):
        return (plane, y, t) if side[0] == 'x' else (t, y, plane)
    # De gauche à droite vu de la rue : t croît vers la droite si `right` est positif.
    left, rightmost = (a, b) if right[0] + right[2] > 0 else (b, a)
    corners = [point(left, y1), point(rightmost, y1), point(rightmost, y2), point(left, y2)]
    uvs = [(u[0], 0), (u[1], 0), (u[1], 1), (u[0], 1)]
    if oriented(corners, normal) is not corners:
        corners, uvs = corners[::-1], uvs[::-1]
    carte.face(corners, material, uvs)


def facade_runs(x1, z1, x2, z2):
    """Parties des côtés d'un mur qui donnent sur une zone jouable : (côté, plan, début, fin, zone)."""
    sides = [('x+', x2, z1, z2, lambda t: (x2 + 0.3, t)), ('x-', x1, z1, z2, lambda t: (x1 - 0.3, t)),
             ('z+', z2, x1, x2, lambda t: (t, z2 + 0.3)), ('z-', z1, x1, x2, lambda t: (t, z1 - 0.3))]
    for side, at, lo, hi, probe in sides:
        run = None
        t = lo + 0.25
        while t < hi:
            zone = zone_at(*probe(t))
            if run and zone == run[2]:
                run[1] = t + 0.25
            else:
                if run and run[2] is not None:
                    yield side, at, run[0], run[1], run[2]
                run = [t - 0.25, t + 0.25, zone]
            t += 0.5
        if run and run[2] is not None:
            yield side, at, run[0], run[1], run[2]


def dress(x1, z1, x2, z2, height, seed):
    for side, at, a, b, zone in facade_runs(x1, z1, x2, z2):
        length = b - a
        if length < 1.0:
            continue
        rng = random.Random(f'{x1},{z1},{side},{a}')
        base = A_HEIGHT if zone in RAISED else 0.0
        planks = 'bluePlanks' if seed < 0.5 else 'greenPlanks'
        relief(side, at, a, b, base, base + 0.7, 0.05, 'stone')  # soubassement
        relief(side, at, a, b, height - 0.3, height, 0.12, 'stone')  # corniche
        # Saleté au-dessus du soubassement (l'image se répète tous les 2 m), coulures sous la corniche.
        decal(side, at, a, b, base + 0.7, base + 1.6, 'decalGrime', (0, length / 2))
        if rng.random() < 0.55:
            w = rng.uniform(1.2, min(3.0, length))
            c = a + rng.uniform(w / 2, length - w / 2)
            decal(side, at, c - w / 2, c + w / 2, height - 0.3 - rng.uniform(1.5, 3.0), height - 0.3, 'decalStreaks')
        if zone != SOUK and height - base >= 5.0:
            count = int((length - 0.6) // 3.2)
            for i in range(count):
                if rng.random() < 0.25:
                    continue
                c = a + length * (i + 0.5) / count
                y = base + 3.6
                relief(side, at, c - 0.6, c + 0.6, y - 0.75, y + 0.75, 0.06, 'stone')
                relief(side, at, c - 0.45, c + 0.45, y - 0.6, y + 0.6, 0.1, planks)
        # Climatiseur au-dessus des fenêtres, tourné vers la rue (le modèle regarde vers +z).
        if zone != SOUK and length >= 4.0 and height - base >= 5.9 and rng.random() < 0.17:
            c = a + rng.uniform(1.0, length - 1.0)
            yaw, offset = {'x+': (90, 0.21), 'x-': (-90, -0.21), 'z+': (0, 0.21), 'z-': (180, -0.21)}[side]
            x, z = (at + offset, c) if side[0] == 'x' else (c, at + offset)
            prop('aircon', x, z, yaw, base + 4.6)
        door = None
        if length >= 3.0 and rng.random() < 0.5:
            door = c = a + length * rng.uniform(0.3, 0.7)
            relief(side, at, c - 0.75, c + 0.75, base, base + 2.6, 0.06, 'stone')
            relief(side, at, c - 0.55, c + 0.55, base, base + 2.3, 0.1, planks)
        # Affiche au-dessus de la saleté du bas des murs (1,6 m), loin de la porte.
        poster = None
        if length >= 2.0 and rng.random() < 0.18:
            c = a + rng.uniform(0.6, length - 0.6)
            if door is None or abs(c - door) > 1.5:
                poster = c
                k = rng.randrange(decals.POSTERS)
                y = base + rng.uniform(1.65, 1.8)
                decal(side, at, c - 0.4, c + 0.4, y, y + 1.1, 'decalPosters', (k / decals.POSTERS, (k + 1) / decals.POSTERS), offset=0.02)
        # Fissure, jamais sur l'affiche.
        if rng.random() < 0.3:
            c = a + rng.uniform(0.8, max(0.8, length - 0.8))
            size = rng.uniform(1.0, 1.8)
            if poster is None or abs(c - poster) > 0.4 + size / 2:
                y = base + rng.uniform(1.0, 2.6)
                decal(side, at, c - size / 2, c + size / 2, y, y + size, 'decalCracks', offset=0.012)


for facade in FACADES:
    dress(*facade)


# --- Portes en travers des rues : mur blanc, linteau de grès sur une poutre, battants ouverts à plat ---
def door_wall(axis, at, span, opening, leaves_side):
    (a, b), (o1, o2) = span, opening
    pieces = ((a, o1, 0, WALL, 'clayWhite'), (o2, b, 0, WALL, 'clayWhite'), (o1, o2, DOOR + 0.2, WALL, 'stone'))
    for p1, p2, y1, y2, material in pieces:
        if axis == 'z':  # mur le long de x, à z = at
            box(p1, at - 0.5, p2, at + 0.5, y1, y2, material, 'plaster', top=False)
        else:  # mur le long de z, à x = at
            box(at - 0.5, p1, at + 0.5, p2, y1, y2, material, 'plaster', top=False)
    leaf = (o2 - o1) / 2
    face = at + 0.5 * leaves_side
    near, far = sorted((face, face + 0.08 * leaves_side))
    for p1, p2 in ((o1 - leaf, o1), (o2, o2 + leaf)):
        if axis == 'z':
            box(p1, near, p2, far, 0, DOOR - 0.05, 'bluePlanks', 'wood')
        else:
            box(near, p1, far, p2, 0, DOOR - 0.05, 'bluePlanks', 'wood')
    if axis == 'z':
        box(o1 - 0.12, at - 0.62, o2 + 0.12, at + 0.62, DOOR, DOOR + 0.2, 'beam', 'wood', solid=False)
    else:
        box(at - 0.62, o1 - 0.12, at + 0.62, o2 + 0.12, DOOR, DOOR + 0.2, 'beam', 'wood', solid=False)


door_wall('z', 30, (-40, -30), (-37, -33), leaves_side=1)  # Portes longues, battants côté sud
door_wall('z', -10, (-6, 6), (-2, 2), leaves_side=-1)  # Portes CT, battants côté CT
door_wall('x', 17.5, (-6, -1), (-5, -2), leaves_side=1)  # Portes B, battants côté B


# --- Arche au-dessus du Milieu : voûte en plein cintre surbaissé, en grès ---
def arch(x1, x2, z1, z2, spring, crown, top, segments=12):
    cx, r = (x1 + x2) / 2, (x2 - x1) / 2
    arc = [(cx - r * math.cos(math.pi * k / segments), spring + (crown - spring) * math.sin(math.pi * k / segments)) for k in range(segments + 1)]
    t = kit.MATERIALS['stone']['tile']
    s = 0.0
    for (xa, ya), (xb, yb) in zip(arc, arc[1:]):
        seg = math.hypot(xb - xa, yb - ya)
        mid = ((xa + xb) / 2, (ya + yb) / 2)
        inward = (cx - mid[0], spring - mid[1], 0)  # vers l'axe de la voûte, donc vers le dessous
        quad = [(xa, ya, z1), (xb, yb, z1), (xb, yb, z2), (xa, ya, z2)]
        uvs = [(s / t, z1 / t), ((s + seg) / t, z1 / t), ((s + seg) / t, z2 / t), (s / t, z2 / t)]
        if oriented(quad, inward) is not quad:
            quad, uvs = quad[::-1], uvs[::-1]
        carte.face(quad, 'stone', uvs)
        s += seg
        for z, want in ((z1, (0, 0, -1)), (z2, (0, 0, 1))):
            quad = [(xa, ya, z), (xb, yb, z), (xb, top, z), (xa, top, z)]
            uvs = [(xa / t, ya / t), (xb / t, yb / t), (xb / t, top / t), (xa / t, top / t)]
            if oriented(quad, want) is not quad:
                quad, uvs = quad[::-1], uvs[::-1]
            carte.face(quad, 'stone', uvs)
    carte.collision((x1, 3.6, z1), (x2, top, z2), 'stone')


arch(-5, 5, 19.5, 20.5, 3.0, 4.3, 5.5)

# --- Voie A : escalier vers la terrasse, caisses ---
carte.stairs('z', -12.2, -1, (-40, -30), 3, 'stone')
crate(-32, 12)
crate(-38.2, -4, SMALL)
crate(-38.2, -3.1, SMALL)
crate(-38.2, 22)

# --- Site A : terrasse dallée sur un socle de grès, Plateau, Rampe CT ---
box(-40, -34, -10, -14, 0, A_HEIGHT - 0.05, 'stone')
box(-40, -34, -10, -14, A_HEIGHT - 0.05, A_HEIGHT, 'paving')
box(-30, -28, -24, -22, A_HEIGHT, A_HEIGHT * 2, 'stone')
crate(-36, -30, BIG, A_HEIGHT)
crate(-17, -20, BIG, A_HEIGHT)
crate(-13, -31, SMALL, A_HEIGHT)
crate(-13, -31, SMALL, A_HEIGHT + SMALL)
carte.stairs('z', -35.8, 1, (-22, -14), 3, 'stone')

# --- Passerelle : galerie surélevée le long de la place, escalier au sud, muret ouvert au milieu ---
box(-14, -14, -10, 0, 0, A_HEIGHT - 0.05, 'stone')
box(-14, -14, -10, 0, A_HEIGHT - 0.05, A_HEIGHT, 'paving')
carte.stairs('z', 3, -1, (-14, -10), 3, 'stone', depth=1.0)
box(-10.2, -10, -10, -6, A_HEIGHT, A_HEIGHT + 0.9, 'stone')
box(-10.2, -3, -10, 0, A_HEIGHT, A_HEIGHT + 0.9, 'stone')

# --- Milieu : caisse, puits ---
crate(-3.5, 26)
carte.prism((0, -2), 1.25, 8, 0, 0.9, 'stone', top_material='stone')
carte.prism((0, -2), 0.95, 8, 0.91, 0.91, 'shadowGap', walls=False)
carte.collision((-1.3, 0, -3.3), (1.3, 1.0, -0.7), 'stone')
for x in (-1.05, 0.95):
    box(x, -2.06, x + 0.1, -1.94, 0.9, 2.5, 'beam', 'wood', solid=False)
box(-1.1, -2.06, 1.1, -1.94, 2.4, 2.52, 'beam', 'wood', solid=False)

# --- Site B : fontaine en zellige, caisses ---
def basin(center, outer, inner, top, water, wall, rim, sides=8):
    """Bassin octogonal : paroi extérieure, margelle en anneau, paroi intérieure, eau en contrebas."""
    carte.prism(center, outer, sides, 0, top, wall, top=False)
    ring = lambda r, y: [(center[0] + r * math.cos(math.pi / sides + 2 * math.pi * k / sides), y,
                          center[1] + r * math.sin(math.pi / sides + 2 * math.pi * k / sides)) for k in range(sides)]
    out, inn, low = ring(outer, top), ring(inner, top), ring(inner, water)
    t = kit.MATERIALS[rim]['tile']
    for k in range(sides):
        j = (k + 1) % sides
        quad = oriented([out[k], out[j], inn[j], inn[k]], (0, 1, 0))
        carte.face(quad, rim, [(p[0] / t, -p[2] / t) for p in quad])
        quad = oriented([inn[k], inn[j], low[j], low[k]], (center[0] - inn[k][0], 0, center[1] - inn[k][2]))
        carte.face(quad, wall, [(i * 0.5, p[1]) for i, p in enumerate(quad)])
    carte.prism(center, inner, sides, water, water, 'water', walls=False)


basin((29, -14), 2.3, 1.95, 0.7, 0.55, 'mosaic', 'stone')
carte.prism((29, -14), 0.35, 8, 0.6, 1.5, 'stone')
carte.prism((29, -14), 0.9, 8, 1.5, 1.7, 'mosaic', top_material='water')
carte.collision((26.8, 0, -16.2), (31.2, 0.8, -11.8), 'stone')
carte.collision((28.6, 0.8, -14.4), (29.4, 1.7, -13.6), 'stone')
crate(22, -28)
crate(36, -6)
crate(24, -4, SMALL)
crate(35, -24)
crate(35, -24, SMALL, BIG)

# --- Souk : bandes de toile colorées à 3,4 m (la lumière passe entre elles), étals sous des auvents ---
FABRICS = ['fabricRed', 'fabricOrange', 'fabricBlue', 'fabricGreen']
z, k = 6.6, 0
while z + 2 <= 36:
    box(22, z, 30, z + 2, 3.4, 3.45, FABRICS[k % 4], 'wood', top=False)
    z += 3.2
    k += 1
for x1, x2, z1, z2, shade in ((22, 23.2, 10, 13, (22, 23.6)), (22, 23.2, 20, 23, (22, 23.6)), (22, 23.2, 28, 31, (22, 23.6)),
                              (28.8, 30, 15, 18, (28.4, 30)), (28.8, 30, 25, 28, (28.4, 30))):
    box(x1, z1, x2, z2, 0, 0.9, 'beam', 'wood')  # étal
    crate((x1 + x2) / 2, z1 + 0.6, 0.5, 0.9)
    crate((x1 + x2) / 2, z2 - 0.7, 0.4, 0.9)
    box(shade[0], z1 - 0.2, shade[1], z2 + 0.2, 2.3, 2.34, FABRICS[int(z1) % 4], solid=False)  # auvent

# --- Spawns ---
crate(-6, 42)
crate(7, 41, SMALL)
crate(-4, -42)
crate(10, -41)

# --- Objets : jarres et plantes, poubelles, voitures bâchées, café sur la place, étals du souk ---
for x, z in ((-9.4, 37.8), (-9.4, 38.6), (-8.7, 38.2), (-7.6, 45.2), (7.6, 45.2), (-20, 36.5), (-28.5, 43.5), (19, -10)):
    prop('clayPot', x, z)
for x, z in ((-9.4, 39.4), (19.1, -9.2), (-39.4, 42.8)):
    prop('jug', x, z, 30)
for x, z in ((-9.3, 35), (9.3, 35), (-13, -45.3), (13, -45.3), (39.4, -33.3)):
    prop('pottedPlant', x, z)
for x, z, yaw in ((9.6, 37.4, 90), (-14, 43.6, 0), (-39.6, 6, 90), (39.6, -1, 90)):
    prop('trashCan', x, z, yaw)
# Barils (et quelques jerricanes) contre les murs des couloirs qui mènent des spawns à la place du puits :
# de quoi se couvrir sans boucher le passage.
for x, z, pid, yaw in (
    (-4.6, 13.0, 'barrelBlue', 20), (-4.6, 13.7, 'barrelRed', 140), (4.6, 23.0, 'barrelRed', 60),
    (4.6, 23.7, 'barrelBlue', 300), (4.0, 23.35, 'barrelBlue', 200), (-4.6, 30.5, 'barrelRed', 10),
    (4.6, 9.0, 'barrelBlue', 90),
    (-5.6, -14.5, 'barrelRed', 30), (-5.6, -15.2, 'barrelBlue', 250), (5.6, -21.5, 'barrelBlue', 120),
    (5.6, -22.2, 'barrelRed', 330), (5.0, -21.85, 'barrelRed', 80), (-5.6, -28.0, 'barrelBlue', 45),
    (-13.5, 5.5, 'barrelRed', 15), (-12.8, 5.5, 'barrelBlue', 200),
    (10.6, -5.5, 'barrelBlue', 70), (11.3, -5.5, 'barrelRed', 160),
):
    prop(pid, x, z, yaw)
for x, z, yaw in ((-4.0, 13.3, 90), (5.0, -14.9, 0), (-12.2, 5.6, 30)):
    prop('jerrycan', x, z, yaw)
prop('coveredCar', 37.6, -20, 0)
prop('coveredCar', -15, -44.6, 90)
for x, z in ((-11.3, -45.4), (-10.6, -45.4)):
    prop('barrelBlue', x, z)
prop('jerrycan', -11, -44.8, 15)
# Café : deux tables le long des façades est de la place et trois autour du puits, chaises de part et
# d'autre. Les chaises regardent vers +z : 90 les tourne vers l'est, -90 vers l'ouest.
def cafe_table(x, z, lantern=True):
    prop('cafeTable', x, z, 90)
    if lantern:
        prop('lantern', x, z + 0.4, 0, 0.75)
    for dz in (-0.5, 0.5):
        prop('plasticChair', x - 0.85, z + dz, 90)
        prop('plasticChair', x + 0.85, z + dz, -90)


for tz in (-0.5, -6.5):
    cafe_table(7.2, tz)
for x, z in ((-4.2, -2), (-1.8, 2.8), (2.6, -6.6)):
    cafe_table(x, z, lantern=False)

# Étals du souk : jarres et caisses en plastique dessus.
for x, z1 in ((22.6, 10), (22.6, 20), (22.6, 28), (29.4, 15), (29.4, 25)):
    prop('jug', x, z1 + 1.5, 0, 0.9)
    prop('crate', x, z1 + 2.0, 90, 0.9)

# --- Câbles électriques tendus au-dessus des rues étroites, d'une façade à l'autre ---
def cable(p1, p2, sag, segments=10, width=0.025):
    """Câble qui pend entre deux points : chaînette approchée, deux rubans croisés par tronçon."""
    pts = []
    for k in range(segments + 1):
        t = k / segments
        pts.append(tuple(p1[i] + (p2[i] - p1[i]) * t for i in range(3)))
        pts[-1] = (pts[-1][0], pts[-1][1] - sag * 4 * t * (1 - t), pts[-1][2])
    for p, q in zip(pts, pts[1:]):
        d = Vector(q) - Vector(p)
        side = d.cross(Vector((0, 1, 0))).normalized() * width / 2
        up = Vector((0, width / 2, 0))
        for off in (side, up):
            quad = [tuple(Vector(p) - off), tuple(Vector(q) - off), tuple(Vector(q) + off), tuple(Vector(p) + off)]
            carte.face(quad, 'cable', [(0, 0), (1, 0), (1, 1), (0, 1)])


cable_rng = random.Random('câbles')
STREETS = [3, 8, 10, 12, 1, 2]  # Longue, Milieu, couloir des Portes CT, Ruelle, cours ouest et est
for index in STREETS:
    (x1, z1, x2, z2), _ = ZONES[index]
    along_z = (z2 - z1) > (x2 - x1)
    lo, hi = (z1, z2) if along_z else (x1, x2)
    t = lo + cable_rng.uniform(2, 6)
    while t < hi - 2:
        y1, y2 = cable_rng.uniform(4.2, 4.8), cable_rng.uniform(4.2, 4.8)
        skew = cable_rng.uniform(-1.5, 1.5)
        if along_z:
            cable((x1, y1, t), (x2, y2, t + skew), cable_rng.uniform(0.3, 0.7))
        else:
            cable((t, y1, z1), (t + skew, y2, z2), cable_rng.uniform(0.3, 0.7))
        t += cable_rng.uniform(5, 11)

# --- Minaret, au nord derrière l'enceinte : repère visible de toute la carte ---
for x1, z1, x2, z2, y1, y2, material in (
    (-2, -52, 2, -48, 0, 15.5, 'clayOchre'),
    (-2.1, -52.1, 2.1, -47.9, 12.5, 13.5, 'mosaic'),
    (-2.6, -52.6, 2.6, -47.4, 15.5, 16, 'stone'),
    (-1.5, -51.5, 1.5, -48.5, 16, 19.5, 'clayWhite'),
    (-1.8, -51.8, 1.8, -48.2, 19.5, 19.9, 'stone'),
    (-0.8, -50.8, 0.8, -49.2, 19.9, 21.4, 'mosaic'),
):
    box(x1, z1, x2, z2, y1, y2, material, solid=False, keep=True)

# --- Palmiers ---
palm.leaf_texture(os.path.join(TEXTURES, 'palmLeaf.png'))
decals.make_all(TEXTURES)
for i, (x, z, h) in enumerate(((20.5, -32, 7.5), (38, -31.5, 6.5), (38, 3.5, 7), (-8.5, 44.5, 6.5), (8.5, 44.5, 7.5),
                               (-22, -44.5, 7), (22, -44.5, 6.5), (8.5, 4.5, 6), (-38.5, 41.5, 6.5))):
    palm.add_palm(carte, x, z, h, seed=i)

obj = carte.build('medina')
props.place(ROOT, PROPS)
bake.setup_lighting(SUN_DIRECTION, 2.5, os.path.join(ROOT, 'public', 'sky', 'sky.hdr'), sky_irradiance=1.9)
density = bake.lightmap_uv(obj, SIZE)
image = bake.bake(obj, SIZE, SAMPLES)
os.makedirs(OUT, exist_ok=True)
scale = bake.save_lightmap(image, os.path.join(OUT, 'lightmap.png'))
bake.export_glb(obj, os.path.join(OUT, 'medina.glb'))
bake.write_json(os.path.join(OUT, 'medina.json'), {
    'lightmapScale': scale,
    'lightmapDensity': density,
    'materials': carte.materials_json(),
    'collisions': carte.collisions(),
    'props': PROPS,
})
