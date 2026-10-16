"""Détails plaqués sur les murs : coulures, saleté au pied des murs, fissures, affiches. Les images (avec
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
        # Délavé par le soleil, bords et coins déchirés.
        cell = cell * 0.8 + 0.2 * np.array([0.9, 0.85, 0.75], dtype=np.float32)
        cell *= (1 + rng.normal(0, 0.04, (cell_h, cell_w, 1))).astype(np.float32)
        edge = np.minimum.reduce([xx, cell_w - 1 - xx, yy, cell_h - 1 - yy]).astype(np.float32)
        ragged = edge > 4 + rng.uniform(0, 10, (cell_h, cell_w)) * (rng.random((cell_h, cell_w)) < 0.15)
        tear = (yy > cell_h * rng.uniform(0.6, 0.9)) & (xx > cell_w * rng.uniform(0.5, 0.8)) & (k % 2 == 0)
        alpha = (ragged & ~tear).astype(np.float32)
        rgba[:, k * cell_w:(k + 1) * cell_w, :3] = cell
        rgba[:, k * cell_w:(k + 1) * cell_w, 3] = alpha
    _save(path, rgba)


def make_all(textures):
    streaks(f'{textures}/decalStreaks.png')
    grime(f'{textures}/decalGrime.png')
    cracks(f'{textures}/decalCracks.png')
    posters(f'{textures}/decalPosters.png')
