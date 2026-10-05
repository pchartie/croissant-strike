import { ECONOMY } from '../config';

/** Argent du joueur en mode manches : primes d'élimination, de victoire et de défaite. */
export class Economy {
  money: number = ECONOMY.start;
  /** Défaites d'affilée (le bonus de défaite augmente avec). */
  private lossStreak = 0;
  /** Dernier gain, pour l'afficher brièvement (« +300 $ Élimination »). */
  lastGain: { amount: number; reason: string; time: number } | null = null;

  reset(): void {
    this.money = ECONOMY.start;
    this.lossStreak = 0;
    this.lastGain = null;
  }

  earn(amount: number, reason: string): void {
    if (amount <= 0) return;
    this.money = Math.min(ECONOMY.max, this.money + amount);
    this.lastGain = { amount, reason, time: performance.now() };
  }

  spend(amount: number): boolean {
    if (amount > this.money) return false;
    this.money -= amount;
    return true;
  }

  roundEnded(won: boolean): void {
    if (won) {
      this.lossStreak = 0;
      this.earn(ECONOMY.roundWin, 'Manche gagnée');
    } else {
      this.earn(Math.min(ECONOMY.lossBase + ECONOMY.lossStep * this.lossStreak, ECONOMY.lossMax), 'Manche perdue');
      this.lossStreak++;
    }
  }
}
