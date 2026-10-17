"""Détails plaqués : coulures, saleté au pied des murs, fissures, affiches, moucharabieh, sable et taches au
sol. Les images (avec
transparence) sont dessinées ici et enregistrées dans public/textures/ : Blender et le jeu utilisent les mêmes.
"""

import math

import numpy as np


def _save(path, rgba):
    """Enregistre une image RGBA (rangée 0 = haut de l'image) en PNG."""
    import bpy
    h, w, _ = rgba.shape
    image = bpy.data.images.new('decal', w, h, alpha=True)
    image.colorspace_settings.name = 'sRGB'
    # Blender range les pixels du bas vers le haut.
    image.pixels.foreach_set(np.clip(rgba[::-1], 0, 1).astype(np.float32).ravel())
    image.filepath_raw = path
    image.file_format = 'PNG'
    image.save()
    bpy.data.images.remove(image)


def _periodic_noise(rng, w, h, octaves=((2, 0.5), (5, 0.3), (11, 0.2))):
    """Bruit doux qui se répète en largeur (la texture se raccorde d'un bout à l'autre)."""
    x = np.arange(w) / w
    y = np.arange(h) / h
    out = np.zeros((h, w), dtype=np.float32)
    for freq, amp in octaves:
        for _ in range(3):
            phase_x, phase_y = rng.uniform(0, 2 * math.pi, 2)
            fy = rng.uniform(0.5, 1.5) * freq
            out += amp / 3 * np.sin(2 * math.pi * freq * x[None, :] + phase_x) * np.sin(2 * math.pi * fy * y[:, None] + phase_y)
    return out


def streaks(path, w=256, h=512, seed=1):
    """Coulures sombres qui descendent d'une corniche : fortes en haut, de plus en plus pâles."""
    rng = np.random.default_rng(seed)
    x = np.arange(w)[None, :]
    y = (np.arange(h) / h)[:, None]
    alpha = np.zeros((h, w), dtype=np.float32)
    for _ in range(14):
        cx, width = rng.uniform(0, w), rng.uniform(3, 18)
        length = rng.uniform(0.25, 1.0)
        column = np.exp(-((x - cx) / width) ** 2)
        fade = np.clip(1 - y / length, 0, 1) ** 1.5
        alpha += column * fade * rng.uniform(0.15, 0.4)
    alpha += np.clip(0.25 - y * 1.5, 0, 1) * 0.6  # bande sombre juste sous la corniche
    alpha *= 1 + _periodic_noise(rng, w, h) * 0.6
    alpha = np.clip(alpha, 0, 0.6)
    color = np.array([0.22, 0.17, 0.12], dtype=np.float32)
    _save(path, np.concatenate([np.broadcast_to(color, (h, w, 3)), alpha[..., None]], axis=-1))


def grime(path, w=512, h=128, seed=2):
    """Saleté et éclaboussures au pied des murs, plus foncées en bas ; se répète en largeur."""
    rng = np.random.default_rng(seed)
    y = (np.arange(h) / h)[:, None]
    alpha = (y ** 1.6) * 0.55 * (1 + _periodic_noise(rng, w, h, ((3, 0.6), (9, 0.4), (23, 0.3))))
    alpha = np.clip(alpha, 0, 0.6)
    color = np.array([0.30, 0.23, 0.16], dtype=np.float32)
    _save(path, np.concatenate([np.broadcast_to(color, (h, w, 3)), alpha[..., None]], axis=-1))


def cracks(path, size=512, seed=3):
    """Fissures qui se ramifient à partir du centre."""
    rng = np.random.default_rng(seed)
    alpha = np.zeros((size, size), dtype=np.float32)
    yy, xx = np.mgrid[0:size, 0:size]

    def crack(x, y, angle, length, width, depth):
        steps = int(length / 3)
        for _ in range(steps):
            angle += rng.normal(0, 0.35)
            x += math.cos(angle) * 3
            y += math.sin(angle) * 3
            if not (4 < x < size - 4 and 4 < y < size - 4):
                return
            x0, x1, y0, y1 = int(x - 6), int(x + 7), int(y - 6), int(y + 7)
            patch = np.exp(-((xx[y0:y1, x0:x1] - x) ** 2 + (yy[y0:y1, x0:x1] - y) ** 2) / (2 * width ** 2))
            alpha[y0:y1, x0:x1] = np.maximum(alpha[y0:y1, x0:x1], patch * 0.85)
            width = max(0.6, width * 0.985)
            if depth < 3 and rng.random() < 0.04:
                crack(x, y, angle + rng.choice([-1, 1]) * rng.uniform(0.5, 1.1), length * 0.5, width * 0.8, depth + 1)

    for k in range(3):
        crack(size / 2, size / 2, rng.uniform(0, 2 * math.pi), size * 0.5, 1.6, 0)
    color = np.array([0.12, 0.09, 0.07], dtype=np.float32)
    _save(path, np.concatenate([np.broadcast_to(color, (size, size, 3)), alpha[..., None]], axis=-1))


POSTERS = 4


def posters(path, cell_w=256, cell_h=384, seed=4):
    """Quatre affiches côte à côte (une par quart de l'image en largeur) : délavées, bords déchirés."""
    rng = np.random.default_rng(seed)
    w, h = cell_w * POSTERS, cell_h
    rgba = np.zeros((h, w, 4), dtype=np.float32)
    palettes = [((0.78, 0.22, 0.16), (0.95, 0.85, 0.55)), ((0.15, 0.35, 0.6), (0.93, 0.9, 0.8)),
                ((0.9, 0.75, 0.25), (0.2, 0.18, 0.15)), ((0.25, 0.5, 0.3), (0.95, 0.92, 0.85))]
    yy, xx = np.mgrid[0:cell_h, 0:cell_w]
    for k in range(POSTERS):
        main, paper = (np.array(c, dtype=np.float32) for c in palettes[k])
        cell = np.broadcast_to(paper, (cell_h, cell_w, 3)).copy()
        # Bandeau de titre, grand visuel, lignes de texte.
        cell[20:80] = main
        cell[100:250, 24:cell_w - 24] = main * 0.6 + paper * 0.4
        cx, cy, r = cell_w / 2, 175, 45
        disc = (xx - cx) ** 2 + (yy - cy) ** 2 < r * r
        cell[disc] = paper * 0.9
        for line in range(5):
            y0 = 270 + line * 18
            length = rng.uniform(0.5, 0.85) * (cell_w - 48)
            cell[y0:y0 + 7, 24:24 + int(length)] = paper * 0.3
        # Délavé par le soleil. Bord irrégulier mais continu (bruit doux le long du contour, pas des pixels
        # isolés qui scintilleraient), et une affiche sur deux déchirée en biais dans un coin.
        cell = cell * 0.8 + 0.2 * np.array([0.9, 0.85, 0.75], dtype=np.float32)
        cell *= (1 + rng.normal(0, 0.04, (cell_h, cell_w, 1))).astype(np.float32)
        edge = np.minimum.reduce([xx, cell_w - 1 - xx, yy, cell_h - 1 - yy]).astype(np.float32)
        wobble = 6 + 3 * np.sin(xx * 0.11 + k) * np.cos(yy * 0.07 + 2 * k) + 2 * np.sin((xx + yy) * 0.31)
        alpha = (edge > wobble).astype(np.float32)
        if k % 2 == 0:
            # Coin bas-droit arraché le long d'une diagonale dentelée.
            cut = (cell_w - xx) + (cell_h - yy) - rng.uniform(70, 110)
            cut += 6 * np.sin(xx * 0.4) + 4 * np.sin(yy * 0.9)
            alpha *= (cut > 0).astype(np.float32)
        rgba[:, k * cell_w:(k + 1) * cell_w, :3] = cell
        rgba[:, k * cell_w:(k + 1) * cell_w, 3] = alpha
    _save(path, rgba)


def lattice(path, size=256, cells=8):
    """Moucharabieh : treillis de bois tourné, losanges ajourés et petits croisillons ; se répète."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size * cells
    # Distance aux diagonales d'une grille : barreaux en losanges.
    u, v = (xx + yy) % 1.0, (xx - yy) % 1.0
    bars = np.minimum(np.minimum(u, 1 - u), np.minimum(v, 1 - v))
    # Petits ronds aux croisements (pièces tournées).
    cx, cy = (xx % 1.0) - 0.5, (yy % 1.0) - 0.5
    knots = np.hypot(cx, cy)
    wood = (bars < 0.09) | (knots < 0.16)
    shade = 0.85 + 0.15 * np.cos(bars * 30)
    color = np.stack([0.42 * shade, 0.27 * shade, 0.16 * shade], axis=-1).astype(np.float32)
    alpha = wood.astype(np.float32)
    _save(path, np.concatenate([color, alpha[..., None]], axis=-1))


def grille(path, size=128):
    """Barreaux de fer : deux montants et une traverse par motif (0,6 m), le reste transparent."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    bar = (np.abs((xx * 2) % 1.0 - 0.5) > 0.46) | (np.abs(yy - 0.5) < 0.03)
    color = np.broadcast_to(np.array([0.11, 0.1, 0.09], dtype=np.float32), (size, size, 3))
    _save(path, np.concatenate([color, bar.astype(np.float32)[..., None]], axis=-1))


def studs_image(path, size=128):
    """Clous de porte en fer, un par motif (0,4 m), avec un reflet."""
    yy, xx = (np.mgrid[0:size, 0:size].astype(np.float32) / size) - 0.5
    r = np.hypot(xx, yy)
    alpha = (r < 0.07).astype(np.float32)
    shade = np.clip(0.25 + 0.6 * np.clip(-(xx + yy) / 0.1, 0, 1), 0, 1)[..., None]
    color = (np.array([0.16, 0.14, 0.12], dtype=np.float32) + shade * 0.25).astype(np.float32)
    _save(path, np.concatenate([color, alpha[..., None]], axis=-1))


def sand(path, w=512, h=128, seed=5):
    """Sable poussé par le vent au pied d'un mur : dense contre le mur (en haut de l'image), s'efface."""
    rng = np.random.default_rng(seed)
    y = (np.arange(h) / h)[:, None]
    noise = _periodic_noise(rng, w, h, ((2, 0.6), (6, 0.4), (17, 0.25)))
    reach = 0.55 + 0.35 * noise  # le tas avance plus ou moins loin du mur
    alpha = np.clip(1 - y / np.maximum(reach, 0.15), 0, 1) ** 1.4 * 0.85
    grain = rng.normal(1, 0.08, (h, w))
    color = np.stack([0.80 * grain, 0.68 * grain, 0.50 * grain], axis=-1).astype(np.float32)
    _save(path, np.concatenate([color, alpha[..., None].astype(np.float32)], axis=-1))


INTERIORS = 4


def interiors(path, cell_w=192, cell_h=256, seed=7):
    """
    Intérieurs vus à travers une fenêtre, côte à côte : pièce en perspective (mur du fond, côtés et plafond
    plus sombres, sol), rideaux tirés sur les côtés, et une lampe allumée ou une étagère. Assez sombres pour
    se lire comme un intérieur même au soleil (l'image est une face plate sur la façade).
    """
    rng = np.random.default_rng(seed)
    walls = [(0.55, 0.42, 0.28), (0.30, 0.42, 0.42), (0.55, 0.36, 0.33), (0.62, 0.58, 0.50)]
    curtains = [(0.55, 0.12, 0.10), (0.85, 0.82, 0.74), (0.16, 0.28, 0.50), (0.60, 0.45, 0.15)]
    rgba = np.ones((cell_h, cell_w * INTERIORS, 4), dtype=np.float32)
    yy, xx = np.mgrid[0:cell_h, 0:cell_w].astype(np.float32)
    u, v = xx / cell_w, yy / cell_h  # v = 0 en haut
    for k in range(INTERIORS):
        img = np.zeros((cell_h, cell_w, 3), dtype=np.float32)
        wall = np.array(walls[k])
        # Mur du fond au centre ; côtés, plafond et sol en perspective autour.
        bx0, bx1, by0, by1 = 0.22, 0.78, 0.18, 0.68
        img[:] = wall * 0.55  # côtés
        back = (u > bx0) & (u < bx1) & (v > by0) & (v < by1)
        img[back] = wall * 0.9
        ceiling = (v < by0) & (v < np.minimum(u, 1 - u) * (by0 / bx0) + 0.001)
        img[ceiling] = wall * 0.38
        floor = (v > by1) & ((1 - v) < np.minimum(u, 1 - u) * ((1 - by1) / bx0) + 0.001)
        img[floor] = np.array([0.30, 0.20, 0.13])
        # Fond plus sombre en haut (lumière qui vient de la fenêtre, par le bas).
        img *= (0.55 + 0.45 * v)[..., None]
        if k % 2 == 0:  # lampe suspendue, halo chaud
            d = np.hypot((u - 0.5) * cell_w, (v - 0.3) * cell_h) / cell_w
            img += np.array([1.0, 0.75, 0.4]) * np.clip(0.35 - d, 0, None)[..., None] * 1.6
            img[(np.abs(u - 0.5) < 0.004) & (v < 0.27)] = 0.05
        else:  # étagère avec des pots
            shelf = (u > 0.3) & (u < 0.7) & (np.abs(v - 0.45) < 0.012)
            img[shelf] = np.array([0.22, 0.14, 0.08])
            for j in range(4):
                cx = 0.35 + 0.1 * j + rng.uniform(-0.02, 0.02)
                pot = (np.abs(u - cx) < 0.025) & (v > 0.38) & (v < 0.44)
                img[pot] = np.array(rng.uniform(0.2, 0.6, 3))
        # Rideaux tirés de chaque côté, avec des plis.
        curtain = np.array(curtains[k])
        width = 0.2 + 0.05 * (k % 3)
        side = (u < width) | (u > 1 - width)
        folds = 0.75 + 0.25 * np.sin(u * 60 + k)
        img[side] = (curtain * folds[..., None])[side]
        # Assombrit les bords (ombre du tableau de la fenêtre).
        edge = np.minimum.reduce([u, 1 - u, v, 1 - v])
        img *= np.clip(0.55 + edge * 6, 0, 1)[..., None]
        rgba[:, k * cell_w:(k + 1) * cell_w, :3] = np.clip(img, 0, 1)
    _save(path, rgba)


STAINS = 4


def stains(path, cell=256, seed=6):
    """Taches au sol, côte à côte : eau sale séchée, huile, deux auréoles de sable mouillé."""
    rng = np.random.default_rng(seed)
    rgba = np.zeros((cell, cell * STAINS, 4), dtype=np.float32)
    yy, xx = (np.mgrid[0:cell, 0:cell].astype(np.float32) / cell) - 0.5
    colors = [(0.20, 0.17, 0.13), (0.08, 0.08, 0.08), (0.35, 0.28, 0.19), (0.25, 0.21, 0.16)]
    for k in range(STAINS):
        angle = np.arctan2(yy, xx)
        radius = 0.33 + 0.06 * np.sin(3 * angle + k) + 0.04 * np.sin(7 * angle + 2 * k) + 0.02 * np.sin(13 * angle)
        distance = np.hypot(xx, yy) / radius
        alpha = np.clip(1 - distance, 0, 1) ** 0.7
        if k in (0, 2):  # auréole : bord plus foncé que le centre
            alpha *= 0.55 + 0.45 * np.clip((distance - 0.7) / 0.3, 0, 1) * (distance < 1)
        alpha *= (0.45 if k != 1 else 0.6) * (1 + 0.25 * rng.normal(0, 1, alpha.shape) * 0.3)
        rgba[:, k * cell:(k + 1) * cell, :3] = colors[k]
        rgba[:, k * cell:(k + 1) * cell, 3] = np.clip(alpha, 0, 0.7)
    _save(path, rgba)


def make_all(textures):
    streaks(f'{textures}/decalStreaks.png')
    grime(f'{textures}/decalGrime.png')
    cracks(f'{textures}/decalCracks.png')
    posters(f'{textures}/decalPosters.png')
    lattice(f'{textures}/decalLattice.png')
    grille(f'{textures}/decalGrille.png')
    studs_image(f'{textures}/decalStuds.png')
    sand(f'{textures}/decalSand.png')
    stains(f'{textures}/decalStains.png')
    interiors(f'{textures}/decalInterior.png')
