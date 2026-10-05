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

  constructor(
    /** Remet tout le monde en place pour une nouvelle manche. */
    private readonly resetRound: () => void,
  ) {}

  get current(): Readonly<RoundStatus> {
    return this.status;
  }

  /** Personne ne bouge pendant le gel ni entre deux manches. */
  get frozen(): boolean {
    return this.status.phase === 'freeze';
  }

  startMatch(): void {
    this.status = this.initial();
    this.beginRound();
  }

  update(dt: number, playerAlive: boolean, botsAlive: number): void {
    const s = this.status;
    s.timeLeft = Math.max(0, s.timeLeft - dt);

    switch (s.phase) {
      case 'freeze':
        if (s.timeLeft === 0) {
          s.phase = 'live';
          s.timeLeft = ROUNDS.roundTime;
        }
        break;
      case 'live':
        if (!playerAlive) this.endRound('bots', 'Tu as été éliminé');
        else if (botsAlive === 0) this.endRound('player', 'Tous les bots sont éliminés');
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
    this.status.phase = 'freeze';
    this.status.timeLeft = ROUNDS.freezeTime;
    this.status.winner = null;
    this.status.reason = '';
    this.resetRound();
  }

  private endRound(winner: Side, reason: string): void {
    const s = this.status;
    if (winner === 'player') s.playerScore++;
    else s.botScore++;
    s.phase = 'over';
    s.winner = winner;
    s.reason = reason;
    s.timeLeft = ROUNDS.roundOverTime;
  }

  private initial(): RoundStatus {
    return { phase: 'freeze', round: 1, playerScore: 0, botScore: 0, timeLeft: 0, winner: null, reason: '' };
  }
}
