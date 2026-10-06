import './style.css';
import { Game } from './core/Game';

const game = new Game(document.body);
game.start();
// En développement seulement : accès au jeu depuis la console (et pour les tests automatisés).
if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
