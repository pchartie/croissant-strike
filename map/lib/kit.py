"""Construction d'une carte dans Blender, en coordonnées du jeu (mètres, y vers le haut).

On déclare des blocs (`Kit.box`), puis `Kit.build()` crée le maillage :
- les faces cachées (contre un autre bloc, sous le sol, hors de la carte) ne sont pas créées :
  moins de triangles, et toute la place de la carte d'éclairage va aux faces visibles ;
- coordonnées de texture (UV 0) en mètres / taille du motif, alignées sur le monde : la texture
  continue d'un bloc à l'autre (sauf les matériaux « par bloc », comme les caisses) ;
- un seul objet, une case de matériau par matériau du jeu (un appel de dessin chacun).

Chaque bloc solide est aussi une collision (boîte), exportée à part pour le jeu.
"""

import math

import bpy
import bmesh
from mathutils import Vector

# Taille maximale d'une face (m) : les grandes faces sont découpées, la carte d'éclairage se range mieux.
MAX_PIECE = 6.0

# Matériaux du jeu : nom → (fichier de texture dans public/textures, teinte sRGB, plaqué par bloc).
# La teinte et la texture ne servent ici qu'aux rebonds de lumière pendant le calcul de l'éclairage :
# dans le jeu, chaque matériau est recréé à partir de son nom (src/world/MapVisuals.ts, mêmes teintes).
MATERIALS = {
    'sand': ('ground', 0xffffff, False),
    'plaster': ('plaster', 0xffffff, False),
    'sandstone': ('sandstone', 0xffffff, False),
    'wood': ('wood', 0xd9a66b, False),
    'crate': (None, 0x6b4522, True),  # couleur moyenne de la texture de caisse dessinée par le jeu
    'shadowGap': (None, 0x1b1814, False),
    # Version grise (quadrillage de 1 m dessiné par le jeu), pour tester un tracé avant de l'habiller.
    'greyWall': (None, 0xb4b2ac, False),
    'greyFloor': (None, 0x8c8a84, False),
    'greyRaised': (None, 0xc49a62, False),
    'greyCover': (None, 0x8f6a4f, False),
    'greyOverhead': (None, 0x7d8b98, False),
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
    def __init__(self, lo, hi, material, tile, surface, solid, top=True):
        self.lo = tuple(lo)
        self.hi = tuple(hi)
        self.material = material
        self.tile = tile
        self.surface = surface
        self.solid = solid
        # Face du dessus dessinée ou non (toits trop hauts pour être vus depuis le sol).
        self.top = top

    def contains(self, p, eps=1e-4):
        return all(self.lo[i] + eps < p[i] < self.hi[i] - eps for i in range(3))


class Kit:
    def __init__(self, bounds_lo, bounds_hi):
        """`bounds` : la zone jouable ; les faces tournées vers l'extérieur ne sont jamais vues."""
        self.bounds_lo = bounds_lo
        self.bounds_hi = bounds_hi
        self.boxes = []

    def box(self, lo, hi, material, tile=1.0, surface=None, solid=True, top=True):
        """Bloc de `lo` à `hi`. `material=None` : collision seule (invisible). `top=False` : sans dessus."""
        self.boxes.append(Box(lo, hi, material, tile, surface, solid, top))

    def stairs(self, axis, start, direction, across, steps, material, tile=1.0, surface='stone', base=0.0, rise=0.3, depth=0.6):
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

    def fill_buildings(self, walkable, height_of, material, tile=1.0, surface='plaster', cell=0.5):
        """
        Remplit de bâtiments tout ce qui n'est pas dans une zone `walkable` (rectangles (x1, z1, x2, z2)),
        à l'intérieur des limites de la carte : grille de `cell` m, regroupée en grands rectangles.
        `height_of(x1, z1, x2, z2)` donne la hauteur de chaque bâtiment. Les toits ne sont pas dessinés.
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
        count = 0
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
                self.box((x1, 0, z1), (x2, height_of(x1, z1, x2, z2), z2), material, tile, surface, top=False)
                count += 1
        print(f'[kit] {count} bâtiments')

    # --- Faces cachées ---

    def _outside(self, p):
        return any(p[i] < self.bounds_lo[i] or p[i] > self.bounds_hi[i] for i in (0, 2)) or p[1] < self.bounds_lo[1]

    def _hidden(self, box, axis, sign):
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
        occluders = [b for b in self.boxes if b is not box and b.material is not None and b.solid]
        return all(self._outside(p) or any(b.contains(p) for b in occluders) for p in samples)

    # --- Maillage ---

    def build(self, name='carte'):
        names = sorted({b.material for b in self.boxes if b.material})
        mesh = bpy.data.meshes.new(name)
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        for material in names:
            obj.data.materials.append(make_material(material))

        bm = bmesh.new()
        uv0 = bm.loops.layers.uv.new('uv0')
        kept = culled = 0
        for box in self.boxes:
            if not box.material:
                continue
            per_box = MATERIALS[box.material][2]
            for axis, sign in FACES:
                if (axis == 1 and sign > 0 and not box.top) or self._hidden(box, axis, sign):
                    culled += 1
                    continue
                kept += 1
                for corners in split(face_corners(box, axis, sign), MAX_PIECE):
                    verts = [bm.verts.new(to_blender(c)) for c in corners]
                    face = bm.faces.new(verts)
                    face.material_index = names.index(box.material)
                    for loop, c in zip(face.loops, corners):
                        loop[uv0].uv = face_uv(box, axis, sign, c, per_box)
        bm.normal_update()
        bm.to_mesh(mesh)
        bm.free()
        print(f'[kit] {kept} faces gardées, {culled} cachées retirées')
        return obj

    def collisions(self):
        out = []
        for b in self.boxes:
            if b.solid:
                out.append({'min': list(b.lo), 'max': list(b.hi), 'surface': b.surface or 'stone'})
        return out


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
    """Matériau Blender pour le calcul de l'éclairage : texture de couleur (UV 0) et teinte."""
    texture, tint, _ = MATERIALS[name]
    tint = linear(tint)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Base Color'].default_value = (*tint, 1)
    if texture:
        uv = nodes.new('ShaderNodeUVMap')
        uv.uv_map = 'uv0'
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(f'{TEXTURES}/{texture}_diff.jpg', check_existing=True)
        mix = nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mix.inputs['B'].default_value = (*tint, 1)
        links.new(uv.outputs['UV'], tex.inputs['Vector'])
        links.new(tex.outputs['Color'], mix.inputs['A'])
        links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    return mat


TEXTURES = ''


def reset_scene(textures_dir):
    """Scène vide, et dossier des textures du jeu."""
    global TEXTURES
    TEXTURES = textures_dir
    bpy.ops.wm.read_factory_settings(use_empty=True)
