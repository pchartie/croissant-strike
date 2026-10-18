"""Médina : vieille ville du Maghreb, trois voies et deux sites (plan : voir le README, section Cartes).

Les zones jouables du plan, des maisons partout ailleurs (crépis de plusieurs teintes, soubassement,
corniche ; fenêtres et portes de plusieurs modèles, un style par façade : volets, arcs, grilles, volets
roulants, moucharabiehs, portes cloutées, auvents, boutiques), les sols de chaque zone et leurs détails
(sable au pied des murs, taches, plaques d'égout), les portes, l'arche, la terrasse A, la passerelle, le
souk sous ses toiles, la fontaine, le puits, une maison ouverte (pièce meublée, éclairée par une lanterne),
le minaret et des palmiers ; éclairage précalculé.

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
BIG, SMALL = 1.85, 1.2  # caisses : la grosse se monte encore accroupi en sautant (1,90 m au plus), la moyenne d'un saut

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


# Bois des caisses : pin clair surtout, bois vieilli, quelques caisses en bois brun-roux.
CRATE_WOODS = ['crateLight'] * 9 + ['crateDark'] * 7 + ['crateWarm'] * 4


def crate(x, z, size=BIG, y=0.0):
    wood = random.Random(f'caisse {x},{z},{y}').choice(CRATE_WOODS)
    box(x - size / 2, z - size / 2, x + size / 2, z + size / 2, y, y + size, wood, 'wood', tile=size)


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


# Maison ouverte, au coin du Milieu et de la place : on entre par la rue, on voit la place par la fenêtre.
INTERIOR = (5.0, 6.0, 10.0, 13.0)
INTERIOR_SHELL = {}  # hauteur et crépi de la maison ouverte (construite plus bas, avec ses façades)


def house(x1, z1, x2, z2):
    rng = random.Random(f'{x1},{z1},{x2},{z2}')
    height = rng.choice([5.0, 5.5, 6.0, 6.5, 7.0, 7.5])
    material = rng.choice(CLAYS)
    if (x1, z1, x2, z2) == INTERIOR:
        INTERIOR_SHELL.update(height=height, material=material)
    else:
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


# Ouvertures percées dans une façade : (côté, plan) → [(t1, t2, y1, y2)]. Les décors (soubassement, saleté,
# fissures) s'arrêtent au bord.
OPENINGS = {}


def cut(t1, t2, y1, y2, holes):
    """Le rectangle (t1, t2, y1, y2) moins les trous : liste de rectangles."""
    rects = [(t1, t2, y1, y2)]
    for h1, h2, hy1, hy2 in holes:
        out = []
        for a, b, c, d in rects:
            if h1 >= b or h2 <= a or hy1 >= d or hy2 <= c:
                out.append((a, b, c, d))
                continue
            m1, m2 = max(a, h1), min(b, h2)
            out += [r for r in ((a, m1, c, d), (m2, b, c, d), (m1, m2, c, max(c, hy1)), (m1, m2, min(d, hy2), d)) if r[1] > r[0] + 1e-6 and r[3] > r[2] + 1e-6]
        rects = out
    return rects


def relief(side, at, a, b, y1, y2, depth, material):
    """Décor collé sur une façade (sans collision) : de `a` à `b` le long du mur, de `y1` à `y2`."""
    holes = OPENINGS.get((side, at))
    if holes:
        for p in cut(a, b, y1, y2, holes):
            relief_piece(side, at, *p, depth, material)
    else:
        relief_piece(side, at, a, b, y1, y2, depth, material)


def relief_piece(side, at, a, b, y1, y2, depth, material):
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


def decal(side, at, a, b, y1, y2, material, u=(0.0, 1.0), offset=0.01, v=(0.0, 1.0)):
    """
    Image plaquée sur une façade, de `a` à `b` le long du mur et de `y1` à `y2` ; `u` = partie de
    l'image en largeur (affiches côte à côte), dans le sens de lecture vu de la rue.
    """
    normal, right = FACING[side]
    holes = OPENINGS.get((side, at))
    if holes and cut(a, b, y1, y2, holes) != [(a, b, y1, y2)]:
        flip = right[0] + right[2] < 0
        def along(t):
            f = (t - a) / (b - a)
            return u[0] + (1 - f if flip else f) * (u[1] - u[0])
        for pa, pb, py1, py2 in cut(a, b, y1, y2, holes):
            pu = (along(pb), along(pa)) if flip else (along(pa), along(pb))
            pv = tuple(v[0] + (y - y1) / (y2 - y1) * (v[1] - v[0]) for y in (py1, py2))
            decal_piece(side, at, pa, pb, py1, py2, material, pu, offset, pv)
        return
    decal_piece(side, at, a, b, y1, y2, material, u, offset, v)


def decal_piece(side, at, a, b, y1, y2, material, u, offset, v):
    normal, right = FACING[side]
    plane = at + offset * (normal[0] + normal[2])
    def point(t, y):
        return (plane, y, t) if side[0] == 'x' else (t, y, plane)
    # De gauche à droite vu de la rue : t croît vers la droite si `right` est positif.
    left, rightmost = (a, b) if right[0] + right[2] > 0 else (b, a)
    corners = [point(left, y1), point(rightmost, y1), point(rightmost, y2), point(left, y2)]
    uvs = [(u[0], v[0]), (u[1], v[0]), (u[1], v[1]), (u[0], v[1])]
    if oriented(corners, normal) is not corners:
        corners, uvs = corners[::-1], uvs[::-1]
    carte.face(corners, material, uvs)


def panel(side, at, outline, material, offset, fit=None):
    """
    Polygone plan convexe plaqué sur une façade : `outline` = [(t le long du mur, y)], à `offset` du mur.
    `fit` = (u0, u1) : l'image couvre le polygone (de gauche à droite vu de la rue), au lieu de se répéter.
    """
    normal, right = FACING[side]
    plane = at + offset * (normal[0] + normal[2])
    tile = kit.MATERIALS[material]['tile']
    corners = [(plane, y, t) if side[0] == 'x' else (t, y, plane) for t, y in outline]
    if fit:
        ts, ys = [t for t, _ in outline], [y for _, y in outline]
        t0, t1, y0, y1 = min(ts), max(ts), min(ys), max(ys)
        flip = right[0] + right[2] < 0  # t décroît vers la droite vue de la rue
        def u(t):
            a = (t - t0) / (t1 - t0)
            return fit[0] + (1 - a if flip else a) * (fit[1] - fit[0])
        uvs = [(u(t), (y - y0) / (y1 - y0)) for t, y in outline]
    else:
        uvs = [(t / tile, y / tile) for t, y in outline]
    if oriented(corners, normal) is not corners:
        corners, uvs = corners[::-1], uvs[::-1]
    carte.face(corners, material, uvs)


def rect(t1, t2, y1, y2):
    return [(t1, y1), (t2, y1), (t2, y2), (t1, y2)]


def arch_outline(c, half, y0, spring, segments=8):
    """Rectangle surmonté d'un demi-cercle (forme convexe) : de `y0` à `spring`, puis l'arc."""
    return [(c - half, y0), (c + half, y0)] + [
        (c + half * math.cos(math.pi * k / segments), spring + half * math.sin(math.pi * k / segments)) for k in range(segments + 1)
    ]


# Objets de façade (modèles tournés vers +z) : lacet selon le côté du mur.
WALL_YAW = {'x+': 90, 'x-': -90, 'z+': 0, 'z-': 180}


def wall_spot(pid, side, at, c, y, depth, gap=0.01):
    """Place d'un objet collé à une façade (`depth` : son épaisseur), centré en `c` le long du mur."""
    normal, _ = FACING[side]
    offset = (depth / 2 + gap) * (normal[0] + normal[2])
    x, z = (at + offset, c) if side[0] == 'x' else (c, at + offset)
    return {'id': pid, 'x': x, 'z': z, 'y': y, 'yaw': WALL_YAW[side]}


def wall_prop(pid, side, at, c, y, depth, gap=0.01):
    """Objet collé à une façade (`depth` : son épaisseur), centré en `c` le long du mur."""
    PROPS.append(wall_spot(pid, side, at, c, y, depth, gap))


def in_block(spot):
    """Vrai si l'objet entre dans un bloc plein de la carte (mur, marche, caisse)."""
    x1, y1, z1, x2, y2, z2 = props.footprint(spot)
    return any(b.solid and b.material is not None and all(lo + 0.02 < bhi and blo + 0.02 < hi for lo, hi, blo, bhi in zip((x1, y1, z1), (x2, y2, z2), b.lo, b.hi))
               for b in carte.boxes)


def ground_props(spots):
    """Pose des objets au pied d'un mur, seulement si aucun n'entre dans un bloc de la carte."""
    if any(in_block(spot) for spot in spots):
        return
    PROPS.extend(spots)


def floor_strip(side, at, a, b, width, y, material, u):
    """Décalque au sol le long d'un mur, de `a` à `b`, sur `width` m vers la rue ; haut de l'image contre le mur."""
    normal, _ = FACING[side]
    sign = normal[0] + normal[2]
    def point(t, d):
        return (at + d * sign, y, t) if side[0] == 'x' else (t, y, at + d * sign)
    corners = [point(a, 0), point(b, 0), point(b, width), point(a, width)]
    uvs = [(u[0], 1), (u[1], 1), (u[1], 0), (u[0], 0)]
    if oriented(corners, (0, 1, 0)) is not corners:
        corners, uvs = corners[::-1], uvs[::-1]
    carte.face(corners, material, uvs)


def floor_decal(x, z, size, y, material, u):
    corners = [(x - size / 2, y, z - size / 2), (x + size / 2, y, z - size / 2), (x + size / 2, y, z + size / 2), (x - size / 2, y, z + size / 2)]
    uvs = [(u[0], 1), (u[1], 1), (u[1], 0), (u[0], 0)]
    if oriented(corners, (0, 1, 0)) is not corners:
        corners, uvs = corners[::-1], uvs[::-1]
    carte.face(corners, material, uvs)


# --- Fenêtres et portes : plusieurs modèles, un style par façade pour qu'elle reste cohérente ---
PLANKS = ['bluePlanks'] * 3 + ['greenPlanks'] * 2 + ['brownPlanks'] * 2 + ['redPlanks']
WINDOWS = ['shutters'] * 3 + ['open'] * 2 + ['arched'] * 2 + ['rolling', 'grille']
DOORS = ['planks'] * 2 + ['arched', 'studded', 'awning']
SHOPS = {0, 1, 2, 8, SOUK}  # spawn T, cours, Milieu, souk : des boutiques au rez-de-chaussée
AWNINGS = ['fabricRed', 'fabricOrange', 'fabricBlue', 'fabricGreen']
IRON = 'cable'


def opening(side, at, outline, grille=True):
    """
    Fenêtre ouverte, barreaux devant (face ajourée) : une sur deux laisse voir une pièce peinte (faux
    intérieur), les autres restent sombres.
    """
    rng = random.Random(f'intérieur {side},{at},{outline[0]}')
    if rng.random() < 0.5:
        k = rng.randrange(decals.INTERIORS)
        panel(side, at, outline, 'decalInterior', 0.062, fit=(k / decals.INTERIORS, (k + 1) / decals.INTERIORS))
    else:
        panel(side, at, outline, 'shadowGap', 0.062)
    if grille:
        panel(side, at, outline, 'decalGrille', 0.075)


def window(style, side, at, c, y, planks):
    """Fenêtre de l'étage centrée en (c, y)."""
    def sill(half):
        relief(side, at, c - half, c + half, y - 0.83, y - 0.75, 0.16, 'stone')
    if style == 'shutters':  # volets fermés
        relief(side, at, c - 0.6, c + 0.6, y - 0.75, y + 0.75, 0.06, 'stone')
        relief(side, at, c - 0.45, c + 0.45, y - 0.6, y + 0.6, 0.1, planks)
        sill(0.7)
    elif style == 'open':  # volets ouverts à plat contre le mur, barreaux devant l'ouverture
        relief(side, at, c - 0.6, c + 0.6, y - 0.75, y + 0.75, 0.06, 'stone')
        opening(side, at, rect(c - 0.45, c + 0.45, y - 0.6, y + 0.6))
        for t1, t2 in ((c - 1.08, c - 0.62), (c + 0.62, c + 1.08)):
            relief(side, at, t1, t2, y - 0.6, y + 0.6, 0.05, planks)
        sill(0.7)
    elif style == 'arched':  # arc en plein cintre, ouverture sombre et barreaux qui suivent l'arc
        spring = y + 0.2
        panel(side, at, arch_outline(c, 0.62, y - 0.78, spring), 'stone', 0.05)
        opening(side, at, arch_outline(c, 0.45, y - 0.62, spring))
        sill(0.72)
    elif style == 'grille':  # petite fenêtre carrée grillagée
        relief(side, at, c - 0.45, c + 0.45, y - 0.45, y + 0.45, 0.06, 'stone')
        opening(side, at, rect(c - 0.32, c + 0.32, y - 0.32, y + 0.32))
        relief(side, at, c - 0.5, c + 0.5, y - 0.53, y - 0.45, 0.14, 'stone')
    else:  # volet roulant métallique (modèle Poly Haven) dans un encadrement
        relief(side, at, c - 0.6, c + 0.6, y - 0.85, y + 0.85, 0.03, 'stone')
        wall_prop('windowShutter', side, at, c, y - 0.78, 0.15, gap=0.035)


def mashrabiya(side, at, c, y):
    """Moucharabieh : caisson de bois en saillie, façade en bois ajouré, petit auvent de tuiles, consoles."""
    relief(side, at, c - 0.75, c + 0.75, y - 0.95, y + 0.85, 0.42, 'brownPlanks')
    panel(side, at, rect(c - 0.62, c + 0.62, y - 0.8, y + 0.72), 'shadowGap', 0.425)
    decal(side, at, c - 0.62, c + 0.62, y - 0.8, y + 0.72, 'decalLattice', (0, 1.24 / 1.52), offset=0.43)
    relief(side, at, c - 0.88, c + 0.88, y + 0.85, y + 0.97, 0.55, 'greenTiles')
    for t1, t2 in ((c - 0.68, c - 0.56), (c + 0.56, c + 0.68)):
        relief(side, at, t1, t2, y - 1.3, y - 0.95, 0.38, 'beam')


def studs(side, at, outline, offset):
    """Clous de porte en fer, sur toute la porte (une face ajourée)."""
    panel(side, at, outline, 'decalStuds', offset)


def door(style, side, at, c, base, planks, rng):
    """Porte au rez-de-chaussée, centrée en `c` ; toujours une marche de pierre devant."""
    relief(side, at, c - 0.8, c + 0.8, base, base + 0.1, 0.32, 'stone')
    if style == 'arched':  # porte en plein cintre, cloutée, avec un heurtoir
        panel(side, at, arch_outline(c, 0.8, base, base + 2.05), 'stone', 0.05)
        panel(side, at, arch_outline(c, 0.6, base, base + 1.95), planks, 0.07)
        studs(side, at, arch_outline(c, 0.6, base + 0.2, base + 1.95), 0.075)
        relief(side, at, c + 0.32, c + 0.4, base + 1.05, base + 1.2, 0.11, IRON)
    elif style == 'studded':  # porte de bois brut, pentures de fer et clous
        relief(side, at, c - 0.75, c + 0.75, base, base + 2.6, 0.06, 'stone')
        relief(side, at, c - 0.55, c + 0.55, base, base + 2.3, 0.1, 'brownPlanks')
        for y in (base + 0.45, base + 1.75):
            panel(side, at, rect(c - 0.55, c + 0.55, y - 0.04, y + 0.04), IRON, 0.102)
        studs(side, at, rect(c - 0.55, c + 0.55, base + 0.2, base + 2.2), 0.104)
        relief(side, at, c - 0.85, c + 0.85, base + 2.6, base + 2.75, 0.14, 'beam')
    else:  # planches, linteau de bois ; auvent de toile rayée pour certaines
        relief(side, at, c - 0.75, c + 0.75, base, base + 2.6, 0.06, 'stone')
        relief(side, at, c - 0.55, c + 0.55, base, base + 2.3, 0.1, planks)
        relief(side, at, c - 0.85, c + 0.85, base + 2.6, base + 2.75, 0.14, 'beam')
        if style == 'awning':
            relief(side, at, c - 1.0, c + 1.0, base + 2.8, base + 2.86, 0.8, rng.choice(AWNINGS))


def clear_of_props(side, at, c, half_width, reach=1.0):
    """Vrai si aucun objet déjà posé n'est devant ce bout de façade (boutique, coffret)."""
    normal, _ = FACING[side]
    sign = normal[0] + normal[2]
    for spot in PROPS:
        along, away = (spot['z'], (spot['x'] - at) * sign) if side[0] == 'x' else (spot['x'], (spot['z'] - at) * sign)
        if abs(along - c) < half_width + 0.5 and -0.1 < away < reach:
            return False
    return True


def shop(side, at, c, base, rng):
    """Boutique : rideau de fer (modèle Poly Haven) dans un encadrement, enseigne peinte au-dessus."""
    relief(side, at, c - 1.2, c + 1.2, base, base + 2.05, 0.04, 'stone')
    wall_prop('shopShutter', side, at, c, base, 0.3, gap=0.045)
    relief(side, at, c - 1.15, c + 1.15, base + 2.15, base + 2.55, 0.06, rng.choice(AWNINGS))


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
        # Un style de fenêtre et une teinte de bois par façade ; une fenêtre sur cinq change de modèle.
        planks = rng.choice(PLANKS)
        style = rng.choice(WINDOWS)
        relief(side, at, a, b, base, base + 0.7, 0.05, 'stone')  # soubassement
        relief(side, at, a, b, height - 0.3, height, 0.12, 'stone')  # corniche
        # Saleté au-dessus du soubassement (l'image se répète tous les 2 m), coulures sous la corniche.
        decal(side, at, a, b, base + 0.7, base + 1.6, 'decalGrime', (0, length / 2))
        if rng.random() < 0.55:
            w = rng.uniform(1.2, min(3.0, length))
            c = a + rng.uniform(w / 2, length - w / 2)
            decal(side, at, c - w / 2, c + w / 2, height - 0.3 - rng.uniform(1.5, 3.0), height - 0.3, 'decalStreaks')
        mashrabiya_at = None
        if zone != SOUK and height - base >= 6.0 and length >= 4.0 and rng.random() < 0.18:
            mashrabiya_at = a + length * rng.uniform(0.35, 0.65)
            mashrabiya(side, at, mashrabiya_at, base + 3.9)
        if zone != SOUK and height - base >= 5.0:
            count = int((length - 0.6) // 3.2)
            for i in range(count):
                if rng.random() < 0.25:
                    continue
                c = a + length * (i + 0.5) / count
                if mashrabiya_at is not None and abs(c - mashrabiya_at) < 2.2:
                    continue
                window(style if rng.random() > 0.2 else rng.choice(WINDOWS), side, at, c, base + 3.75, planks)
        # Climatiseur au-dessus des fenêtres, tourné vers la rue (le modèle regarde vers +z).
        if zone != SOUK and length >= 4.0 and height - base >= 6.0 and rng.random() < 0.17:
            c = a + rng.uniform(1.0, length - 1.0)
            if mashrabiya_at is None or abs(c - mashrabiya_at) > 1.9:
                wall_prop('aircon', side, at, c, base + 4.75, 0.38)
        # Objets ajoutés après coup : leur propre tirage, pour ne pas changer le reste des façades.
        extra = random.Random(f'{x1},{z1},{side},{a},objets')
        # Une façade percée (maison ouverte) n'a pas d'autre porte, et rien ne se pose devant le trou.
        holes = [h for h in OPENINGS.get((side, at), []) if a <= h[0] and h[1] <= b]
        door_at = (holes[0][0] + holes[0][1]) / 2 if holes else None
        if door_at is None and length >= 3.0 and rng.random() < 0.5:
            door_at = c = a + length * rng.uniform(0.3, 0.7)
            if zone in SHOPS and length >= 3.4 and rng.random() < 0.45 and clear_of_props(side, at, c, 1.2):
                shop(side, at, c, base, rng)
            else:
                door(rng.choice(DOORS), side, at, c, base, planks, rng)
        # Coffret électrique au pied du mur, dans les rues, loin de la porte.
        if zone not in RAISED and length >= 3.0 and rng.random() < 0.1:
            c = a + rng.uniform(0.6, length - 0.6)
            if (door_at is None or abs(c - door_at) > 1.6) and clear_of_props(side, at, c, 0.3):
                wall_prop('utilityBox', side, at, c, base, 0.43)
        # Sable poussé par le vent au pied du mur, par endroits.
        if rng.random() < 0.4:
            w = rng.uniform(1.5, min(5.0, length))
            c = a + rng.uniform(w / 2, length - w / 2)
            floor_strip(side, at, c - w / 2, c + w / 2, rng.uniform(0.5, 0.9), base + 0.008, 'decalSand', (0, w / 2))
        # Affiche au-dessus de la saleté du bas des murs (1,6 m), loin de la porte.
        poster = None
        if length >= 2.0 and rng.random() < 0.18:
            c = a + rng.uniform(0.6, length - 0.6)
            if door_at is None or abs(c - door_at) > 1.7:
                poster = c
                k = rng.randrange(decals.POSTERS)
                y = base + rng.uniform(1.65, 1.8)
                decal(side, at, c - 0.4, c + 0.4, y, y + 1.1, 'decalPosters', (k / decals.POSTERS, (k + 1) / decals.POSTERS), offset=0.02)
        # Au pied du mur (au-delà du soubassement), loin de la porte : deux bonbonnes de gaz, un vieux pneu appuyé ou un bac en bois.
        if zone not in RAISED and length >= 2.5:
            roll = extra.random()
            c = a + extra.uniform(0.7, length - 0.7)
            if door_at is None or abs(c - door_at) > 1.5:
                if roll < 0.1 and clear_of_props(side, at, c, 0.55):
                    ground_props([wall_spot('gasBottle', side, at, c + dc, base, 0.44, gap=0.07) for dc in (-0.24, 0.24)])
                elif roll < 0.14 and zone != SOUK and clear_of_props(side, at, c, 0.35):
                    ground_props([wall_spot('tyre', side, at, c, base, 0.165, gap=0.07)])
                elif roll < 0.34 and clear_of_props(side, at, c, 0.7):
                    ground_props([wall_spot('planterBox', side, at, c, base, 0.58, gap=0.07)])
        # Fissure, jamais sur l'affiche.
        if rng.random() < 0.3:
            c = a + rng.uniform(0.8, max(0.8, length - 0.8))
            size = rng.uniform(1.0, 1.8)
            if poster is None or abs(c - poster) > 0.4 + size / 2:
                y = base + rng.uniform(1.0, 2.6)
                decal(side, at, c - size / 2, c + size / 2, y, y + size, 'decalCracks', offset=0.012)




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
crate(-38.2, -4.15, SMALL)
crate(-38.2, -2.95, SMALL)
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

# --- Site B : fontaine ronde en zellige, caisses ---
# Mêmes dimensions que FountainSpec dans src/world/maps.ts (l'eau animée se pose dessus).
FOUNTAIN = (29, -14)
ROUND = 40  # côtés des formes rondes


def basin(center, outer, inner, top, water, wall, rim, sides=ROUND, base=0.0, water_material='water'):
    """Bassin rond : paroi extérieure, margelle en anneau, paroi intérieure, eau en contrebas."""
    carte.prism(center, outer, sides, base, top, wall, top=False)
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
    carte.prism(center, inner, sides, water, water, water_material, walls=False)


def annulus(center, r_in, r_out, y, material, sides=ROUND):
    """Couronne horizontale (dessus d'un anneau), entre deux rayons."""
    ring = lambda r: [(center[0] + r * math.cos(math.pi / sides + 2 * math.pi * k / sides), y,
                       center[1] + r * math.sin(math.pi / sides + 2 * math.pi * k / sides)) for k in range(sides)]
    out, inn = ring(r_out), ring(r_in)
    t = kit.MATERIALS[material]['tile']
    for k in range(sides):
        j = (k + 1) % sides
        quad = oriented([out[k], out[j], inn[j], inn[k]], (0, 1, 0))
        carte.face(quad, material, [(p[0] / t, -p[2] / t) for p in quad])


def turned(center, profile, material, sides=ROUND):
    """Pièce tournée (pied, vasque) : anneaux empilés d'après un profil [(rayon, bas, haut)]."""
    for radius, y1, y2 in profile:
        carte.prism(center, radius, sides, y1, y2, material)


# Marche de pierre tout autour, puis le bassin (margelle au bord arrondi : deux anneaux en retrait).
carte.prism(FOUNTAIN, 3.3, ROUND, 0, 0.12, 'stone')
basin(FOUNTAIN, 3.04, 2.6, 0.74, 0.6, 'mosaic', 'stone', base=0.12)
carte.prism(FOUNTAIN, 3.09, ROUND, 0.58, 0.68, 'stone', top=False)  # bourrelet sous la margelle
annulus(FOUNTAIN, 3.04, 3.09, 0.68, 'stone')
# Pied tourné : base, fût, collerette ; vasque bombée (trois anneaux qui s'évasent) et son eau.
turned(FOUNTAIN, [(0.62, 0.6, 0.78), (0.5, 0.78, 0.86), (0.33, 0.86, 1.55), (0.42, 1.55, 1.63), (0.55, 1.63, 1.7)], 'stone')
turned(FOUNTAIN, [(0.8, 1.7, 1.78), (1.02, 1.78, 1.86)], 'mosaic')
basin(FOUNTAIN, 1.18, 1.05, 1.96, 1.92, 'mosaic', 'stone', base=1.86)
# Fleuron au centre de la vasque, d'où part le jet.
turned(FOUNTAIN, [(0.16, 1.92, 2.05), (0.11, 2.05, 2.16), (0.07, 2.16, 2.22)], 'stone', sides=16)
# Collisions : un disque approché par trois boîtes (sans coins qui dépassent), et le pied.
fx, fz = FOUNTAIN
for hx, hz in ((3.1, 1.4), (1.4, 3.1), (2.2, 2.2)):
    carte.collision((fx - hx, 0, fz - hz), (fx + hx, 0.8, fz + hz), 'stone')
carte.collision((fx - 0.5, 0.8, fz - 0.5), (fx + 0.5, 1.96, fz + 0.5), 'stone')
# --- Puits de la place du Milieu : socle, paroi à frise de zellige, margelle, conduit sombre, treuil à
# manivelle avec sa corde et son seau, petit toit de tuiles vertes sur deux poteaux ---
def hcylinder(y, z, x1, x2, radius, material, sides=8):
    """Cylindre couché le long de x (treuil), d'axe (y, z)."""
    t = kit.MATERIALS[material]['tile']
    ring = [(y + radius * math.cos(2 * math.pi * k / sides), z + radius * math.sin(2 * math.pi * k / sides)) for k in range(sides)]
    side = 2 * radius * math.sin(math.pi / sides)
    for k in range(sides):
        (ya, za), (yb, zb) = ring[k], ring[(k + 1) % sides]
        quad = [(x1, ya, za), (x2, ya, za), (x2, yb, zb), (x1, yb, zb)]
        mid = ((ya + yb) / 2 - y, (za + zb) / 2 - z)
        u = [(0, k * side / t), (1, k * side / t), (1, (k + 1) * side / t), (0, (k + 1) * side / t)]
        if oriented(quad, (0, mid[0], mid[1])) is not quad:
            quad, u = quad[::-1], u[::-1]
        carte.face(quad, material, u)
    for x, want in ((x1, (-1, 0, 0)), (x2, (1, 0, 0))):
        cap = [(x, ya, za) for ya, za in ring]
        cap = oriented(cap, want)
        carte.face(cap, material, [(p[2] / t, p[1] / t) for p in cap])


def well(cx, cz):
    carte.prism((cx, cz), 1.5, 8, 0, 0.15, 'stone')  # socle
    basin((cx, cz), 1.25, 0.9, 0.95, 0.2, 'stone', 'paving', water_material='deepWater')  # paroi, margelle, conduit, eau au fond
    carte.prism((cx, cz), 1.27, 8, 0.5, 0.72, 'mosaic', top=False)  # frise de zellige
    carte.collision((cx - 1.5, 0, cz - 1.5), (cx + 1.5, 0.15, cz + 1.5), 'stone')
    carte.collision((cx - 1.3, 0, cz - 1.3), (cx + 1.3, 1.0, cz + 1.3), 'stone')
    # Poteaux, traverse, treuil à manivelle.
    for x in (cx - 1.12, cx + 0.96):
        box(x, cz - 0.08, x + 0.16, cz + 0.08, 0.95, 2.62, 'beam', 'wood', solid=False)
    box(cx - 1.2, cz - 0.09, cx + 1.2, cz + 0.09, 2.5, 2.66, 'beam', 'wood', solid=False)
    hcylinder(2.15, cz, cx - 0.96, cx + 0.96, 0.11, 'beam')
    box(cx + 1.12, cz - 0.03, cx + 1.2, cz + 0.03, 1.95, 2.21, 'beam', 'wood', solid=False)  # manivelle
    box(cx + 1.2, cz - 0.03, cx + 1.38, cz + 0.03, 1.95, 2.01, 'beam', 'wood', solid=False)
    # Corde et seau, au-dessus du conduit.
    box(cx - 0.015, cz - 0.015, cx + 0.015, cz + 0.015, 1.32, 2.04, 'cable', solid=False)
    carte.prism((cx, cz), 0.16, 8, 1.02, 1.32, 'beam')
    # Petit toit à deux pentes, tuiles dessus, bois dessous, pignons en bois.
    ridge, eave, half, over = 3.05, 2.66, 0.95, 1.45
    for sgn in (-1, 1):
        top = [(cx - over, ridge, cz), (cx + over, ridge, cz), (cx + over, eave, cz + sgn * half), (cx - over, eave, cz + sgn * half)]
        t = kit.MATERIALS['greenTiles']['tile']
        uv = [(p[0] / t, (p[1] - eave) / t * 2.4) for p in top]
        if oriented(top, (0, 1, sgn * 0.4)) is not top:
            top, uv = top[::-1], uv[::-1]
        carte.face(top, 'greenTiles', uv)
        under = top[::-1]
        carte.face(under, 'beam', [(p[0], p[2]) for p in under])
    for x, want in ((cx - over, (-1, 0, 0)), (cx + over, (1, 0, 0))):
        gable = oriented([(x, eave, cz - half), (x, eave, cz + half), (x, ridge, cz)], want)
        carte.face(gable, 'beam', [(p[2], p[1]) for p in gable])
    carte.collision((cx - over, eave, cz - half), (cx + over, ridge, cz + half), 'wood')


well(0, -2)

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
# Faïences bleues (cassables) avec les jarres.
for x, z in ((-8.6, 39.1), (19.8, -9.7), (-39.3, 42.0)):
    prop('faienceVase', x, z)
for x, z in ((-9.3, 35), (9.3, 35), (-13, -45.3), (13, -45.3), (39.4, -33.3)):
    prop('pottedPlant', x, z)
for x, z, yaw in ((9.6, 37.4, 90), (-14, 43.6, 0), (-39.6, 6, 90), (39.6, -1, 90)):
    prop('trashCan', x, z, yaw)
# Barils (et quelques jerricanes) contre les murs des couloirs qui mènent des spawns à la place du puits :
# de quoi se couvrir sans boucher le passage.
for x, z, pid, yaw in (
    (-4.6, 13.0, 'barrelBlue', 20), (-4.6, 13.7, 'barrelRed', 140), (4.6, 23.0, 'barrelRed', 60),
    (4.6, 23.7, 'barrelBlue', 300), (4.0, 23.35, 'barrelBlue', 200), (-4.6, 30.5, 'barrelRed', 10),
    (4.6, 8.4, 'barrelBlue', 90),
    (-5.6, -14.5, 'barrelRed', 30), (-5.6, -15.2, 'barrelBlue', 250), (5.6, -21.5, 'barrelBlue', 120),
    (5.6, -22.2, 'barrelRed', 330), (5.0, -21.85, 'barrelRed', 80), (-5.6, -28.0, 'barrelBlue', 45),
    (-13.5, 5.5, 'barrelRed', 15), (-12.8, 5.5, 'barrelBlue', 200),
    (10.6, -5.5, 'barrelBlue', 70), (11.3, -5.5, 'barrelRed', 160),
):
    prop(pid, x, z, yaw)
for x, z, yaw in ((-4.0, 13.3, 90), (5.0, -14.9, 0), (-12.2, 5.6, 30)):
    prop('jerrycan', x, z, yaw)
prop('coveredCar', 37.6, -20, 0)
prop('coveredCar', -17.6, -44.6, 90)
for x, z in ((-11.3, -45.4), (-10.6, -45.4)):
    prop('barrelBlue', x, z)
prop('jerrycan', -11, -44.8, 15)
# Café : deux tables le long des façades est de la place et trois autour du puits, chaises de part et
# d'autre. Les chaises regardent vers +z : 90 les tourne vers l'est, -90 vers l'ouest.
# Sièges : chaises en plastique, chaises de bois bleues et tabourets peints, mélangés d'une table à l'autre
# (ouest nord, ouest sud, est nord, est sud).
def cafe_table(x, z, seats=('plasticChair',) * 4, lantern=True):
    prop('cafeTable', x, z, 90)
    if lantern:
        prop('lantern', x, z + 0.4, 0, 0.75)
    for seat, (dx, dz, yaw) in zip(seats, ((-0.85, -0.5, 90), (-0.85, 0.5, 90), (0.85, -0.5, -90), (0.85, 0.5, -90))):
        prop(seat, x + dx, z + dz, yaw)


P, B, S = 'plasticChair', 'blueChair', 'woodenStool'
cafe_table(7.2, -0.5, (P, P, B, B))
cafe_table(7.2, -6.5, (S, P, P, S))
cafe_table(-4.2, -2, (B, B, P, P), lantern=False)
cafe_table(-1.8, 2.8, (P, S, S, P), lantern=False)
cafe_table(2.6, -6.6, (B, P, B, S), lantern=False)

# Étals du souk : jarre, marmite de cuivre ou faïence bleue, puis caisse en plastique ou vase de laiton.
for x, z1, front, back in ((22.6, 10, 'jug', 'crate'), (22.6, 20, 'brassPot', 'brassVase'), (22.6, 28, 'jug', 'brassVase'),
                           (29.4, 15, 'brassPot', 'crate'), (29.4, 25, 'faienceVase', 'crate')):
    prop(front, x, z1 + 1.2, 0, 0.9)
    prop(back, x, z1 + 1.75, 90 if back == 'crate' else 0, 0.9)

# --- Détails au sol : plaques d'égout dans les rues pavées, taches, bancs le long des places, sacs de ciment ---
for x, z in ((-35.5, 4), (-35, 28), (1.2, 20), (1, -24), (-25, 40), (20, 40.5), (14, -3.5), (8, -38)):
    prop('manhole', x, z, y=-0.065)  # à ras du sol : seul le dessus dépasse (5 mm)
for x, z, yaw in ((-9.72, 42.5, 90), (-7, -9.72, 0), (39.72, -12, -90), (-7.5, -45.72, 0), (18, -45.72, 0)):
    prop('bench', x, z, yaw)
for x, z, y, yaw in ((-38.5, 36.8, 0, 0), (-38.5, 36.8, 0.18, 6), (-38.5, 36.8, 0.36, -5), (-37.9, 36.8, 0, 3), (-37.9, 36.8, 0.18, -4),
                     (16.3, -5.6, 0, 90), (16.3, -5.6, 0.18, 84)):
    prop('cementBag', x, z, yaw, y)
stain_rng = random.Random('taches')
paved = [rect_ for rect_, floor in ZONES if floor in ('cobble', 'paving', 'stoneTiles')]
for _ in range(16):
    zx1, zz1, zx2, zz2 = stain_rng.choice(paved)
    size = stain_rng.uniform(0.8, 1.7)
    if min(zx2 - zx1, zz2 - zz1) < size + 1.2:
        continue
    x, z = stain_rng.uniform(zx1 + 0.6 + size / 2, zx2 - 0.6 - size / 2), stain_rng.uniform(zz1 + 0.6 + size / 2, zz2 - 0.6 - size / 2)
    k = stain_rng.randrange(decals.STAINS)
    y = A_HEIGHT if zone_at(x, z) in RAISED else 0.0
    floor_decal(x, z, size, y + 0.008, 'decalStains', (k / decals.STAINS, (k + 1) / decals.STAINS))


def check_crates():
    """Signale les caisses qui entrent dans un mur, un autre bloc ou une autre caisse (hors piles posées dessus)."""
    crates = [b for b in carte.boxes if b.material and b.material.startswith('crate')]
    found = 0
    for c in crates:
        for b in carte.boxes:
            if b is c or not b.solid or b.material is None:
                continue
            if all(c.lo[k] + 0.01 < b.hi[k] and b.lo[k] + 0.01 < c.hi[k] for k in range(3)):
                found += 1
                print(f'[caisses] {c.lo}..{c.hi} entre dans {b.material} {b.lo}..{b.hi}')
    print(f'[caisses] {len(crates)} caisses, {found} contact(s) en trop')


def check_props_against_blocks():
    """Signale les objets posés au sol qui entrent dans une caisse ou un mur (les objets de façade sont collés au mur)."""
    found = 0
    for spot in PROPS:
        # Objets de façade (collés au mur) et plaques d'égout (enfoncées dans le sol exprès).
        if spot['id'] in ('aircon', 'windowShutter', 'shopShutter', 'utilityBox', 'lantern', 'manhole'):
            continue
        x1, y1, z1, x2, y2, z2 = props.footprint(spot)
        for b in carte.boxes:
            if not b.solid or b.material is None:
                continue
            if all(lo + 0.02 < bhi and blo + 0.02 < hi for lo, hi, blo, bhi in zip((x1, y1, z1), (x2, y2, z2), b.lo, b.hi)):
                found += 1
                print(f"[props] {spot['id']} ({spot['x']}, {spot['z']}) entre dans un bloc {b.material} {b.lo}..{b.hi}")
                break
    print(f'[props] {found} objet(s) dans un bloc')


# --- Maison ouverte (INTERIOR) : pièce de séjour au rez-de-chaussée, porte à deux battants ouverts sur le
# Milieu, fenêtre sans barreaux sur la place (on y voit et on y tire, sans passer). Murs de 30 cm doublés à
# l'intérieur (zellige en bas, chaux au-dessus), plafond de planches sur poutres, sol carrelé ; banquette,
# caisse et sa lanterne (une lampe dans l'éclairage précalculé), jarres et faïences qui se cassent.
WALL_IN = 0.3  # épaisseur des murs
LINING = 0.03  # doublage intérieur
CEILING = 3.0
DADO = 1.1  # haut du zellige
DOOR_SPAN, DOOR_TOP = (10.2, 11.8), 2.45  # porte (z) : 1,6 m, deux cases de passage pour les bots
WINDOW_SPAN, WINDOW_SILL, WINDOW_TOP = (6.4, 7.6), 1.05, 2.15  # fenêtre (x) : trop basse pour s'y glisser
LANTERN_LIGHT = (9.06, 1.85, 12.06)  # au-dessus de la lanterne (posée sur la caisse du coin)


def interior():
    x1, z1, x2, z2 = INTERIOR
    height, material = INTERIOR_SHELL['height'], INTERIOR_SHELL['material']
    i1, j1, i2, j2 = x1 + WALL_IN, z1 + WALL_IN, x2 - WALL_IN, z2 - WALL_IN  # la pièce
    door = (DOOR_SPAN[0], DOOR_SPAN[1], 0, DOOR_TOP)
    win = (WINDOW_SPAN[0], WINDOW_SPAN[1], WINDOW_SILL, WINDOW_TOP)
    OPENINGS[('x-', x1)] = [door]
    OPENINGS[('z-', z1)] = [win]
    # Murs : (axe du plan, plan extérieur, plan intérieur, début, fin, trous). Les murs nord et sud
    # vont d'un coin à l'autre, ceux d'est et d'ouest entre les deux.
    walls = (('x', x1, i1, j1, j2, [door]), ('x', x2, i2, j1, j2, []),
             ('z', z1, j1, x1, x2, [win]), ('z', z2, j2, x1, x2, []))
    for axis, outer, inner, a, b, holes in walls:
        lining = inner + (LINING if inner > outer else -LINING)
        la, lb = (j1 + LINING, j2 - LINING) if axis == 'x' else (i1, i2)
        layers = [(outer, inner, a, b, 0, CEILING, material, 'plaster')]
        layers += [(inner, lining, la, lb, 0, DADO, 'mosaic', 'stone'), (inner, lining, la, lb, DADO, CEILING - LINING, 'clayWhite', 'plaster')]
        for p, q, t1, t2, y1, y2, mat, surface in layers:
            p, q = sorted((p, q))
            for ta, tb, ya, yb in cut(t1, t2, y1, y2, holes):
                if axis == 'x':
                    box(p, ta, q, tb, ya, yb, mat, surface)
                else:
                    box(ta, p, tb, q, ya, yb, mat, surface)
    # Étage plein au-dessus, plafond de planches et poutres, sol carrelé (et le seuil de la porte).
    box(x1, z1, x2, z2, CEILING, height, material, 'plaster', top=False)
    box(i1, j1, i2, j2, CEILING - LINING, CEILING, 'brownPlanks', 'wood')
    for k in range(5):
        z = j1 + 0.55 + k * (j2 - j1 - 1.1) / 4
        box(i1 + LINING, z - 0.08, i2 - LINING, z + 0.08, CEILING - 0.2, CEILING - LINING, 'beam', 'wood', solid=False)
    box(i1, j1, i2, j2, -1, 0, 'stoneTiles')
    box(x1, DOOR_SPAN[0], i1, DOOR_SPAN[1], -1, 0, 'stone')
    # Porte : encadrement de grès, linteau de bois, battants cloutés ouverts à plat contre la façade.
    c, half = sum(DOOR_SPAN) / 2, (DOOR_SPAN[1] - DOOR_SPAN[0]) / 2
    relief('x-', x1, c - half - 0.18, c - half, 0, DOOR_TOP, 0.07, 'stone')
    relief('x-', x1, c + half, c + half + 0.18, 0, DOOR_TOP, 0.07, 'stone')
    relief('x-', x1, c - half - 0.25, c + half + 0.25, DOOR_TOP, DOOR_TOP + 0.18, 0.15, 'beam')
    for t1, t2 in ((c - 2 * half - 0.18, c - half - 0.18), (c + half + 0.18, c + 2 * half + 0.18)):
        box(x1 - 0.13, t1, x1 - 0.07, t2, 0, DOOR_TOP - 0.1, 'greenPlanks', 'wood')
        studs('x-', x1, rect(t1 + 0.06, t2 - 0.06, 0.2, DOOR_TOP - 0.3), 0.132)
    # Fenêtre : encadrement, appui, volets ouverts contre le mur.
    c, half = sum(WINDOW_SPAN) / 2, (WINDOW_SPAN[1] - WINDOW_SPAN[0]) / 2
    relief('z-', z1, c - half - 0.15, c - half, WINDOW_SILL, WINDOW_TOP, 0.06, 'stone')
    relief('z-', z1, c + half, c + half + 0.15, WINDOW_SILL, WINDOW_TOP, 0.06, 'stone')
    relief('z-', z1, c - half - 0.15, c + half + 0.15, WINDOW_TOP, WINDOW_TOP + 0.15, 0.06, 'stone')
    relief('z-', z1, c - half - 0.25, c + half + 0.25, WINDOW_SILL - 0.08, WINDOW_SILL, 0.16, 'stone')
    for t1, t2 in ((c - 2 * half - 0.17, c - half - 0.17), (c + half + 0.17, c + 2 * half + 0.17)):
        relief('z-', z1, t1, t2, WINDOW_SILL, WINDOW_TOP, 0.05, 'greenPlanks')
    # Banquette le long du mur est : socle de zellige, matelas, coussins contre le mur.
    k1, k2 = j1 + 0.5, j2 - 1.45
    box(i2 - 0.68, k1, i2 - LINING, k2, 0, 0.32, 'mosaic', 'stone')
    box(i2 - 0.7, k1, i2 - LINING, k2, 0.32, 0.45, 'fabricBlue', 'sand')
    box(i2 - 0.2, k1 + 0.05, i2 - LINING, k2 - 0.05, 0.45, 0.85, 'fabricRed', 'sand', solid=False)
    # Tapis (sans collision) ; caisses et lanterne dans le coin, jarres et vases.
    box(i1 + 1.1, j1 + 1.6, i2 - 0.9, j2 - 1.4, 0, 0.012, 'fabricRed', solid=False)
    crate(i2 - LINING - 0.61, j2 - LINING - 0.61, SMALL)
    prop('lantern', LANTERN_LIGHT[0], LANTERN_LIGHT[2], 0, SMALL)
    prop('crate', i2 - 1.6, j2 - 0.3, 0)
    prop('crate', i2 - 1.6, j2 - 0.3, 6, 0.25)
    for pid, x, z in (('faienceVase', i1 + 0.3, j1 + 0.3), ('jug', i1 + 0.28, j2 - 0.3),
                      ('faienceVase', i2 - 0.3, j1 + 0.3), ('brassPot', i1 + 1.95, j2 - 0.28)):
        prop(pid, x, z)


interior()


# Façades habillées après les objets : boutiques et coffrets évitent ce qui est déjà posé devant.
for facade in FACADES:
    dress(*facade)


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
props.check_overlaps(PROPS)
check_props_against_blocks()
check_crates()
props.place(ROOT, PROPS)
bake.setup_lighting(SUN_DIRECTION, 2.5, os.path.join(ROOT, 'public', 'sky', 'sky.hdr'), sky_irradiance=1.9)
bake.point_light(LANTERN_LIGHT, (1.0, 0.72, 0.42), 70)
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
