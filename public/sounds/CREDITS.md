# Sons

Tous les sons de ce dossier sont sous licence **CC0** (domaine public) : utilisables librement, sans obligation de citer.

| Fichiers | Source | Auteur |
|---|---|---|
| `rifle-*.wav` (AR-15), `pistol-*.wav` (1911), `shotgun-*.wav` (Nova), `smg-*.wav` (Carl Gustav M45, filtrée comme par un silencieux) | [The Free Firearm Sound Library](https://opengameart.org/content/the-free-firearm-sound-library) | Free Firearm Sound Library |
| `reload-rifle.wav` | [Gun reload sounds](https://opengameart.org/content/gun-reload-sounds) (`assaultriflereload1.wav`) | SpringySpringo |
| `reload-pistol.wav` | [Handgun Reload Sound Effect](https://opengameart.org/content/handgun-reload-sound-effect) | zer0_sol |
| `step-*.wav`, `impact-*.wav` | [Impact Sounds](https://kenney.nl/assets/impact-sounds) | Kenney |

Les coups de feu ont été découpés, passés en mono 44,1 kHz et normalisés avec `scripts/prepare-sounds.mjs`.
Les variantes `-far` sont les prises de son à distance, utilisées pour les tirs des bots éloignés.
Les sons Kenney (`.ogg`) ont été convertis en WAV mono 44,1 kHz (lisibles par tous les navigateurs) :
pas sur béton (`step-stone`), bois (`step-wood`), neige pour le sable (`step-sand`) et plaque de métal
(`step-metal`) ; impacts `impactMining` (pierre), `impactWood`/`impactPlank` (bois), `impactSoft` (sable),
`impactMetal` (métal).
