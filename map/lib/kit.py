"""Construction d'une carte dans Blender, en coordonnées du jeu (mètres, y vers le haut).

On déclare des blocs (`Kit.box`) et des faces libres (`Kit.face`, `Kit.prism`), puis `Kit.build()`
crée le maillage :
- les faces de blocs cachées (contre un autre bloc, sous le sol, hors de la carte) ne sont pas créées :
  moins de triangles, et toute la place de la carte d'éclairage va aux faces visibles ;
- coordonnées de texture (UV 0) en mètres / taille du motif, alignées sur le monde : la texture
  continue d'un bloc à l'autre (sauf les matériaux « par bloc », comme les caisses) ;
- un seul objet, une case de matériau par matériau du jeu (un appel de dessin chacun).

Chaque bloc solide est aussi une collision (boîte), exportée à part pour le jeu. Les matériaux
utilisés sont exportés eux aussi (`Kit.materials_json`) : le jeu les recrée à partir de cette liste.
"""

import math

import bpy
import bmesh
from mathutils import Vector

# Taille maximale d'une face (m) : les grandes faces sont découpées, la carte d'éclairage se range mieux.
MAX_PIECE = 6.0


def M(texture=None, tint=0xffffff, tile=1.0, per_box=False, canvas=None, alpha=False, shown=None, blend=False, double=False):
    """
    Un matériau : texture Poly Haven (public/textures/<texture>_diff.webp) ou dessinée par le jeu
    (`canvas` : nom d'une fonction de src/world/textures.ts), teinte sRGB, taille réelle d'un motif (m).
    `per_box` : la texture couvre chaque face de bloc (caisses) au lieu de suivre le monde.
    `alpha` : image à transparence public/textures/<canvas>.png, découpée net (palmes, affiches).
    `blend` : transparence progressive, posée sur une autre surface (coulures, fissures).
    `double` : vu des deux côtés (palmes).
    `shown` : teinte dans le jeu, si elle diffère (texture dessinée déjà en couleur, comme la caisse).
    """
    return {'texture': texture, 'tint': tint, 'tile': tile, 'per_box': per_box, 'canvas': canvas, 'alpha': alpha or blend,
            'blend': blend, 'double': double, 'shown': tint if shown is None else shown}


# Matériaux des cartes. Ici, la teinte et la texture servent aux rebonds de lumière pendant le calcul de
# l'éclairage ; pour les textures dessinées par le jeu, `tint` est aussi leur couleur moyenne.
MATERIALS = {
    # Dunes
    'sand': M('ground', tile=2.48),
    'plaster': M('plaster', tile=2),
    'sandstone': M('sandstone', tile=3),
    'wood': M('wood', 0xd9a66b, tile=1),
    'crate': M(tint=0x6b4522, per_box=True, canvas='crate', shown=0xffffff),
    'shadowGap': M(tint=0x1b1814),
    # Version grise (quadrillage de 1 m), pour tester un tracé avant de l'habiller.
    'greyWall': M(tint=0xb4b2ac, canvas='grid'),
    'greyFloor': M(tint=0x8c8a84, canvas='grid'),
    'greyRaised': M(tint=0xc49a62, canvas='grid'),
    'greyCover': M(tint=0x8f6a4f, canvas='grid'),
    'greyOverhead': M(tint=0x7d8b98, canvas='grid'),
    # Médina : crépis de plusieurs teintes, sols, bois peint, tissus, fontaine, palmiers.
    'clayOchre': M('clay', 0xf2dcb8, tile=2),
    'clayWhite': M('clay', 0xffffff, tile=2),
    'clayPink': M('clay', 0xf5cdb8, tile=2),
    'clayRed': M('redPlaster', 0xffffff, tile=2),
    'stone': M('sandstone', 0xf0e4d0, tile=3),
    'cobble': M('cobble', tile=1),
    'packedSand': M('packedSand', tile=1.8),
    'paving': M('paving', tile=2),
    'stoneTiles': M('stoneTiles', 0xf2e4cf, tile=1.5),
    'mosaic': M('mosaic', tile=1),
    'bluePlanks': M('bluePlanks', tile=1),
    'greenPlanks': M('greenPlanks', tile=1.5),
    # Autres teintes de portes et volets : le bois brut, foncé ou peint en rouge sang-de-bœuf.
    'brownPlanks': M('wood', 0x9a6a44, tile=1),
    'redPlanks': M('wood', 0xa8473a, tile=1),
    'beam': M('wood', 0xb98a5a, tile=1),
    'greenTiles': M('roofTiles', 0x8fc49a, tile=1.5),  # tuiles vernissées vertes (toit du puits)
    'fabricRed': M(tint=0xb23a2a, canvas='stripes', tile=2),
    'fabricOrange': M(tint=0xd9822b, canvas='stripes', tile=2),
    'fabricBlue': M(tint=0x2f5f8f, canvas='stripes', tile=2),
    'fabricGreen': M(tint=0x4f7a3a, canvas='stripes', tile=2),
    'water': M(tint=0x3f7f86),
    'deepWater': M(tint=0x1e3a3c),  # eau au fond du puits
    'palmTrunk': M(tint=0x7a6347, canvas='palmTrunk', tile=1),
    'palmLeaf': M(canvas='palmLeaf', alpha=True, double=True),  # couleurs dans l'image (map/lib/palm.py)
    # Détails plaqués (images de map/lib/decals.py) et câbles électriques.
    'decalStreaks': M(canvas='decalStreaks', blend=True),
    'decalGrime': M(canvas='decalGrime', blend=True),
    'decalCracks': M(canvas='decalCracks', blend=True),
    'decalPosters': M(canvas='decalPosters', alpha=True),
    'decalLattice': M(canvas='decalLattice', alpha=True),  # moucharabieh (bois ajouré)
    'decalGrille': M(canvas='decalGrille', alpha=True, tile=0.6),  # barreaux de fenêtre (une face par grille)
    'decalStuds': M(canvas='decalStuds', alpha=True, tile=0.4),  # clous de porte
    'decalSand': M(canvas='decalSand', blend=True),  # sable au pied des murs
    'decalStains': M(canvas='decalStains', blend=True),  # taches sur le sol
    'cable': M(tint=0x1c1a18),
}


def linear(hex_color):
    """Teinte sRGB (comme dans le jeu) → valeurs linéaires (comme Blender les attend)."""
    def channel(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(channel((hex_color >> shift) & 0xff) for shift in (16, 8, 0))


# Sens des 6 faces d'une boîte : (axe, signe).
FACES = [(0, 1), (0, -1), (1, 1), (1, -1), (2, 1), (2, -1)]


def to_blender(p):
    """Jeu (x, y vers le haut, z vers le sud) → Blender (x, y vers le nord, z vers le haut).
    C'est une rotation (celle qu'annule l'export glTF) : l'orientation des faces est conservée."""
    return Vector((p[0], -p[2], p[1]))


class Box:
    def __init__(self, lo, hi, material, tile, surface, solid, top=True, keep=False):
        self.lo = tuple(lo)
        self.hi = tuple(hi)
        self.material = material
        self.tile = tile
        self.surface = surface
        self.solid = solid
        # Face du dessus dessinée ou non (toits trop hauts pour être vus depuis le sol).
        self.top = top
        # Gardé même hors de la carte (repère visible de loin, comme le minaret).
        self.keep = keep

    def contains(self, p, eps=1e-4):
        return all(self.lo[i] + eps < p[i] < self.hi[i] - eps for i in range(3))


class Kit:
    def __init__(self, bounds_lo, bounds_hi):
        """`bounds` : la zone jouable ; les faces tournées vers l'extérieur ne sont jamais vues."""
        self.bounds_lo = bounds_lo
        self.bounds_hi = bounds_hi
        self.boxes = []
        # Faces libres : (coins, matériau, UV).
        self.faces = []
        # Collisions sans bloc visible (fontaine octogonale, troncs…).
        self.extra_collisions = []

    def box(self, lo, hi, material, tile=None, surface=None, solid=True, top=True, keep=False):
        """
        Bloc de `lo` à `hi`. `material=None` : collision seule (invisible). `solid=False` : décor sans
        collision (encadrements, volets…). `top=False` : sans dessus. `tile` : taille du motif (par défaut
        celle du matériau).
        """
        if tile is None:
            tile = MATERIALS[material]['tile'] if material else 1.0
        self.boxes.append(Box(lo, hi, material, tile, surface, solid, top, keep))

    def collision(self, lo, hi, surface):
        """Collision seule, sans rien de visible (la forme visible est faite de faces libres)."""
        self.extra_collisions.append({'min': list(lo), 'max': list(hi), 'surface': surface})

    def face(self, corners, material, uvs):
        """Face libre (polygone plan convexe, coins dans le sens inverse des aiguilles vu de devant)."""
        self.faces.append((corners, material, uvs))

    def prism(self, center, radius, sides, y1, y2, material, top=True, walls=True, tile=None, phase=None, top_material=None):
        """
        Prisme à `sides` côtés (octogone…) posé en `center` (x, z), de `y1` à `y2`. `walls=False` : le
        dessus seul (eau d'un bassin) ; `top_material` : autre matériau pour le dessus (margelle).
        """
        tile = tile or MATERIALS[material]['tile']
        cx, cz = center
        phase = math.pi / sides if phase is None else phase
        ring = [(cx + radius * math.cos(phase + 2 * math.pi * k / sides), cz + radius * math.sin(phase + 2 * math.pi * k / sides)) for k in range(sides)]
        side = 2 * radius * math.sin(math.pi / sides)
        for k in range(sides if walls else 0):
            (x1, z1), (x2, z2) = ring[k], ring[(k + 1) % sides]
            u0 = k * side / tile
            self.face([(x2, y1, z2), (x1, y1, z1), (x1, y2, z1), (x2, y2, z2)], material,
                      [(u0, y1 / tile), (u0 + side / tile, y1 / tile), (u0 + side / tile, y2 / tile), (u0, y2 / tile)])
        if top:
            pts = [(x, y2, z) for x, z in reversed(ring)]
            top_material = top_material or material
            top_tile = MATERIALS[top_material]['tile']
            self.face(pts, top_material, [(x / top_tile, -z / top_tile) for x, _, z in pts])

    def stairs(self, axis, start, direction, across, steps, material, surface='stone', base=0.0, rise=0.3, depth=0.6, tile=None):
        """
        Escalier de `steps` marches qui monte dans la direction `direction` (+1 ou -1) le long de l'axe
        `axis` ('x' ou 'z'), en partant de `start` ; `across` = (début, fin) dans l'autre axe.
        Chaque marche est un bloc plein, de `base` jusqu'à sa hauteur.
        """
        for k in range(1, steps + 1):
            near = start + direction * (k - 1) * depth
            far = start + direction * k * depth
            a, b = min(near, far), max(near, far)
            top = base + k * rise
            if axis == 'z':
                self.box((across[0], 0, a), (across[1], top, b), material, tile, surface)
            else:
                self.box((a, 0, across[0]), (b, top, across[1]), material, tile, surface)

    def fill_buildings(self, walkable, house, cell=0.5, max_size=None):
        """
        Remplit de maisons tout ce qui n'est pas dans une zone `walkable` (rectangles (x1, z1, x2, z2)),
        à l'intérieur des limites de la carte : grille de `cell` m, regroupée en grands rectangles, eux-mêmes
        découpés en maisons d'au plus `max_size` m de côté. `house(x1, z1, x2, z2)` pose chaque maison et
        renvoie ce qu'on veut en garder ; la fonction renvoie la liste de ces résultats.
        """
        x0, z0 = self.bounds_lo[0], self.bounds_lo[2]
        cols = round((self.bounds_hi[0] - x0) / cell)
        rows = round((self.bounds_hi[2] - z0) / cell)
        free = [[False] * cols for _ in range(rows)]
        for x1, z1, x2, z2 in walkable:
            for r in range(round((z1 - z0) / cell), round((z2 - z0) / cell)):
                for c in range(round((x1 - x0) / cell), round((x2 - x0) / cell)):
                    free[r][c] = True
        used = [[False] * cols for _ in range(rows)]
        houses = []
        for r in range(rows):
            for c in range(cols):
                if free[r][c] or used[r][c]:
                    continue
                w = 1
                while c + w < cols and not free[r][c + w] and not used[r][c + w]:
                    w += 1
                h = 1
                while r + h < rows and all(not free[r + h][c + k] and not used[r + h][c + k] for k in range(w)):
                    h += 1
                for rr in range(r, r + h):
                    for cc in range(c, c + w):
                        used[rr][cc] = True
                x1, z1 = x0 + c * cell, z0 + r * cell
                x2, z2 = x1 + w * cell, z1 + h * cell
                for px1, px2 in _pieces(x1, x2, max_size):
                    for pz1, pz2 in _pieces(z1, z2, max_size):
                        houses.append(house(px1, pz1, px2, pz2))
        print(f'[kit] {len(houses)} maisons')
        return houses

    # --- Faces cachées ---

    def _outside(self, p):
        return any(p[i] < self.bounds_lo[i] or p[i] > self.bounds_hi[i] for i in (0, 2)) or p[1] < self.bounds_lo[1]

    def _hidden(self, box, axis, sign, occluders):
        """Vraie si toute la face est contre un bloc opaque, sous le sol ou hors de la carte."""
        u, v = [i for i in range(3) if i != axis]
        plane = box.hi[axis] if sign > 0 else box.lo[axis]
        samples = []
        for fu in (0.02, 0.5, 0.98):
            for fv in (0.02, 0.5, 0.98):
                p = [0.0, 0.0, 0.0]
                p[axis] = plane + sign * 0.02
                p[u] = box.lo[u] + (box.hi[u] - box.lo[u]) * fu
                p[v] = box.lo[v] + (box.hi[v] - box.lo[v]) * fv
                samples.append(p)
        near = [b for b in occluders if b is not box and all(b.lo[i] - 0.05 <= box.hi[i] and b.hi[i] + 0.05 >= box.lo[i] for i in range(3))]
        outside = (lambda p: False) if box.keep else self._outside
        return all(outside(p) or any(b.contains(p) for b in near) for p in samples)

    # --- Maillage ---

    def build(self, name='carte'):
        names = sorted({b.material for b in self.boxes if b.material} | {f[1] for f in self.faces})
        mesh = bpy.data.meshes.new(name)
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        for material in names:
            obj.data.materials.append(make_material(material))

        bm = bmesh.new()
        uv0 = bm.loops.layers.uv.new('uv0')
        occluders = [b for b in self.boxes if b.material is not None and b.solid]
        kept = culled = 0
        for box in self.boxes:
            if not box.material:
                continue
            per_box = MATERIALS[box.material]['per_box']
            for axis, sign in FACES:
                if (axis == 1 and sign > 0 and not box.top) or self._hidden(box, axis, sign, occluders):
                    culled += 1
                    continue
                kept += 1
                for corners in split(face_corners(box, axis, sign), MAX_PIECE):
                    face = bm.faces.new([bm.verts.new(to_blender(c)) for c in corners])
                    face.material_index = names.index(box.material)
                    for loop, c in zip(face.loops, corners):
                        loop[uv0].uv = face_uv(box, axis, sign, c, per_box)
        for corners, material, uvs in self.faces:
            face = bm.faces.new([bm.verts.new(to_blender(c)) for c in corners])
            face.material_index = names.index(material)
            for loop, uv in zip(face.loops, uvs):
                loop[uv0].uv = uv
        bm.normal_update()
        bm.to_mesh(mesh)
        bm.free()
        print(f'[kit] {kept} faces de blocs gardées, {culled} cachées retirées, {len(self.faces)} faces libres')
        self.used_materials = names
        return obj

    def collisions(self):
        out = [{'min': list(b.lo), 'max': list(b.hi), 'surface': b.surface or 'stone'} for b in self.boxes if b.solid]
        return out + self.extra_collisions

    def materials_json(self):
        """Matériaux utilisés, pour que le jeu les recrée (src/world/MapVisuals.ts)."""
        out = {}
        for name in self.used_materials:
            m = MATERIALS[name]
            entry = {'color': m['shown']}
            if m['texture']:
                entry['texture'] = m['texture']
            if m['canvas']:
                entry['canvas'] = m['canvas']
            for flag in ('alpha', 'blend', 'double'):
                if m[flag]:
                    entry[flag] = True
            out[name] = entry
        return out


def _pieces(a, b, size):
    """Découpe [a, b] en morceaux d'au plus `size` (à peu près égaux, alignés sur 0,5 m)."""
    if not size or b - a <= size:
        return [(a, b)]
    n = math.ceil((b - a) / size)
    cuts = [a] + [round((a + (b - a) * k / n) * 2) / 2 for k in range(1, n)] + [b]
    return list(zip(cuts, cuts[1:]))


def face_corners(box, axis, sign):
    """Coins d'une face, dans l'ordre inverse des aiguilles d'une montre vu de l'extérieur."""
    u, v = [(axis + 1) % 3, (axis + 2) % 3]
    plane = box.hi[axis] if sign > 0 else box.lo[axis]
    quad = [(box.lo[u], box.lo[v]), (box.hi[u], box.lo[v]), (box.hi[u], box.hi[v]), (box.lo[u], box.hi[v])]
    if sign < 0:
        quad.reverse()
    out = []
    for a, b in quad:
        p = [0.0, 0.0, 0.0]
        p[axis], p[u], p[v] = plane, a, b
        out.append(p)
    return out


def split(corners, size):
    """Découpe une face rectangulaire en morceaux d'au plus `size` mètres de côté (même ordre des coins)."""
    a, b, c, d = (Vector(p) for p in corners)
    nu = max(1, math.ceil((b - a).length / size))
    nv = max(1, math.ceil((d - a).length / size))
    du, dv = (b - a) / nu, (d - a) / nv
    for i in range(nu):
        for j in range(nv):
            o = a + du * i + dv * j
            yield [tuple(o), tuple(o + du), tuple(o + du + dv), tuple(o + dv)]


def face_uv(box, axis, sign, p, per_box):
    """UV en mètres / motif. Côtés : u horizontal, v vertical ; dessus et dessous : x et z."""
    origin = box.lo if per_box else (0.0, 0.0, 0.0)
    t = box.tile
    x, y, z = (p[i] - origin[i] for i in range(3))
    if axis == 0:
        return (-sign * z / t, y / t)
    if axis == 2:
        return (sign * x / t, y / t)
    return (x / t, -z / t)


def make_material(name):
    """Matériau Blender pour le calcul de l'éclairage : texture de couleur (UV 0), teinte, transparence."""
    spec = MATERIALS[name]
    tint = linear(spec['tint'])
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Base Color'].default_value = (*tint, 1)
    image = None
    if spec['texture']:
        image = bpy.data.images.load(f'{TEXTURES}/{spec["texture"]}_diff.webp', check_existing=True)
    elif spec['alpha'] and spec['canvas']:
        # Texture à transparence dessinée par le jeu : la même image, enregistrée par la carte.
        image = bpy.data.images.load(f'{TEXTURES}/{spec["canvas"]}.png', check_existing=True)
    if image:
        uv = nodes.new('ShaderNodeUVMap')
        uv.uv_map = 'uv0'
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = image
        mix = nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mix.inputs['B'].default_value = (*tint, 1)
        links.new(uv.outputs['UV'], tex.inputs['Vector'])
        links.new(tex.outputs['Color'], mix.inputs['A'])
        links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
        if spec['alpha']:
            links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
    return mat


TEXTURES = ''


def reset_scene(textures_dir):
    """Scène vide, et dossier des textures du jeu."""
    global TEXTURES
    TEXTURES = textures_dir
    bpy.ops.wm.read_factory_settings(use_empty=True)
