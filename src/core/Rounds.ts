import { ROUNDS } from '../config';

export type RoundPhase = 'freeze' | 'live' | 'over' | 'matchOver';
export type Side = 'player' | 'bots';

export interface RoundStatus {
  phase: RoundPhase;
  round: number;
  playerScore: number;
  botScore: number;
  /** Temps restant de la phase en cours, en secondes. */
  timeLeft: number;
  /** Vainqueur de la manche (ou du match) qui vient de se terminer. */
  winner: Side | null;
  /** Raison de la fin de manche (« Temps écoulé »…). */
  reason: string;
}

/**
 * Déroulement d'un match en manches, comme dans CS : gel au départ, chrono,
 * victoire en éliminant le camp adverse (les bots gagnent si le temps
 * s'écoule, comme les CT), et le premier à `ROUNDS.toWin` manches gagne.
 */
export class Rounds {
  private status: RoundStatus = this.initial();
  /** Le joueur avait des coéquipiers dans cette manche (pour le message de défaite). */
  private hadAllies = false;

  constructor(
    private readonly hooks: {
      /** Remet tout le monde en place pour une nouvelle manche (`newMatch` : premier tour d'un match). */
      reset(newMatch: boolean): void;
      /** Une manche vient de se terminer. */
      ended(winner: Side): void;
    },
  ) {}

  get current(): Readonly<RoundStatus> {
    return this.status;
  }

  /** Temps écoulé depuis le début de la manche en cours (gel exclu), pour la fenêtre d'achat. */
  get elapsed(): number {
    return this.status.phase === 'live' ? ROUNDS.roundTime - this.status.timeLeft : 0;
  }

  /** Personne ne bouge pendant le gel ni entre deux manches. */
  get frozen(): boolean {
    return this.status.phase === 'freeze';
  }

  startMatch(): void {
    this.status = this.initial();
    this.beginRound();
  }

  /**
   * `alliesAlive` : coéquipiers bots encore en vie (la manche continue tant qu'il en reste un).
   * `bombPlanted` : une fois la bombe posée, ni le chrono ni la mort de l'équipe du joueur ne
   * terminent la manche ; seules l'explosion ou le désamorçage le font (voir `end`).
   */
  update(dt: number, playerAlive: boolean, botsAlive: number, alliesAlive = 0, bombPlanted = false): void {
    const s = this.status;
    s.timeLeft = Math.max(0, s.timeLeft - dt);
    if (alliesAlive > 0) this.hadAllies = true;

    switch (s.phase) {
      case 'freeze':
        if (s.timeLeft === 0) {
          s.phase = 'live';
          s.timeLeft = ROUNDS.roundTime;
        }
        break;
      case 'live':
        if (botsAlive === 0) this.endRound('player', 'Tous les ennemis sont éliminés');
        else if (bombPlanted) break;
        else if (!playerAlive && alliesAlive === 0) this.endRound('bots', this.hadAllies ? 'Ton équipe a été éliminée' : 'Tu as été éliminé');
        else if (s.timeLeft === 0) this.endRound('bots', 'Temps écoulé');
        break;
      case 'over':
        if (s.timeLeft === 0) {
          if (Math.max(s.playerScore, s.botScore) >= ROUNDS.toWin) {
            s.phase = 'matchOver';
            s.timeLeft = ROUNDS.matchOverTime;
          } else {
            s.round++;
            this.beginRound();
          }
        }
        break;
      case 'matchOver':
        if (s.timeLeft === 0) this.startMatch();
        break;
    }
  }

  private beginRound(): void {
    this.hadAllies = false;
    this.status.phase = 'freeze';
    this.status.timeLeft = ROUNDS.freezeTime;
    this.status.winner = null;
    this.status.reason = '';
    this.hooks.reset(this.status.round === 1);
  }

  /** Fin de manche décidée ailleurs (bombe qui explose ou désamorcée). */
  end(winner: Side, reason: string): void {
    if (this.status.phase === 'live') this.endRound(winner, reason);
  }

  private endRound(winner: Side, reason: string): void {
    const s = this.status;
    if (winner === 'player') s.playerScore++;
    else s.botScore++;
    s.phase = 'over';
    s.winner = winner;
    s.reason = reason;
    s.timeLeft = ROUNDS.roundOverTime;
    this.hooks.ended(winner);
  }

  private initial(): RoundStatus {
    return { phase: 'freeze', round: 1, playerScore: 0, botScore: 0, timeLeft: 0, winner: null, reason: '' };
  }
}
