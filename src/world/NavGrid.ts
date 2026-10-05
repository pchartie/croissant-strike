import * as THREE from 'three';
import { MOVE } from '../config';

const CELL = 0.5;
const SQRT2 = Math.SQRT2;
/** Petite marge pour les comparaisons de hauteurs. */
const EPSILON = 0.01;

/**
 * Grille de navigation pour les bots : la carte découpée en cases de 50 cm,
 * chacune avec la hauteur de son sol (sol, marche, plateforme…). On passe
 * d'une case à sa voisine si elle n'est pas plus haute qu'une marche ; on
 * peut toujours descendre.
 *
 * La carte ne doit pas avoir de sol au-dessus d'un autre sol (pas de pont ni
 * de tunnel) : chaque case n'a qu'une hauteur.
 */
export class NavGrid {
  private readonly cols: number;
  private readonly rows: number;
  private readonly originX: number;
  private readonly originZ: number;
  /** Hauteur du sol de chaque case. */
  private readonly floor: Float32Array;
  private readonly blocked: Uint8Array;
  /** Cases atteignables depuis le point de départ du joueur (pas le haut des murs, etc.). */
  private readonly reachable: Uint8Array;
  private readonly reachableCells: number[] = [];

  constructor(colliders: readonly THREE.Box3[], bounds: THREE.Box3, clearance: number, start: THREE.Vector3) {
    this.originX = bounds.min.x;
    this.originZ = bounds.min.z;
    this.cols = Math.ceil((bounds.max.x - bounds.min.x) / CELL);
    this.rows = Math.ceil((bounds.max.z - bounds.min.z) / CELL);
    const size = this.cols * this.rows;
    this.floor = new Float32Array(size).fill(-Infinity);
    this.blocked = new Uint8Array(size);
    this.reachable = new Uint8Array(size);

    // Sol de chaque case : le dessus du bloc le plus haut sous son centre.
    for (const box of colliders) {
      this.forEachCell(box, 0, (i) => {
        this.floor[i] = Math.max(this.floor[i], box.max.y);
      });
    }

    // Case bloquée si un bot centré dessus toucherait quelque chose de plus haut qu'une marche.
    for (const box of colliders) {
      this.forEachCell(box, clearance, (i) => {
        if (box.max.y > this.floor[i] + MOVE.stepSize) this.blocked[i] = 1;
      });
    }
    for (let i = 0; i < size; i++) {
      if (this.floor[i] === -Infinity) this.blocked[i] = 1;
    }

    this.markReachable(start);
  }

  /** Hauteur du sol à cet endroit. */
  floorAt(x: number, z: number): number {
    const [c, r] = this.cellOf(x, z);
    return this.inside(c, r) ? this.floor[r * this.cols + c] : -Infinity;
  }

  /** Vrai si un bot qui se tient à `from` peut faire un pas jusqu'en (x, z) en restant au même niveau. */
  canStepTo(from: THREE.Vector3, x: number, z: number): boolean {
    const [c, r] = this.cellOf(x, z);
    if (!this.usable(c, r)) return false;
    return Math.abs(this.floor[r * this.cols + c] - from.y) <= MOVE.stepSize + EPSILON;
  }

  randomWalkablePoint(): THREE.Vector3 {
    const i = this.reachableCells[Math.floor(Math.random() * this.reachableCells.length)];
    return this.center(i);
  }

  /** Chemin de `from` à `to` sous forme de points de passage, ou null si inaccessible. */
  findPath(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] | null {
    const start = this.nearestUsable(...this.cellOf(from.x, from.z));
    const goal = this.nearestUsable(...this.cellOf(to.x, to.z));
    if (start === null || goal === null) return null;

    const size = this.cols * this.rows;
    const cost = new Float32Array(size).fill(Infinity);
    const parent = new Int32Array(size).fill(-1);
    const closed = new Uint8Array(size);
    const open = new MinHeap();
    cost[start] = 0;
    open.push(start, this.heuristic(start, goal));

    while (open.size > 0) {
      const current = open.pop();
      if (current === goal) return this.smooth(this.unwind(parent, goal), from, to);
      if (closed[current]) continue;
      closed[current] = 1;

      this.forEachNeighbor(current, (next, step) => {
        const newCost = cost[current] + step;
        if (newCost < cost[next]) {
          cost[next] = newCost;
          parent[next] = current;
          open.push(next, newCost + this.heuristic(next, goal));
        }
      });
    }
    return null;
  }

  /** Vrai si on peut aller en ligne droite de a à b sans obstacle ni marche trop haute. */
  hasClearLine(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const distance = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(distance / (CELL * 0.5));
    let height = this.floorAt(a.x, a.z);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const [c, r] = this.cellOf(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
      if (!this.usable(c, r)) return false;
      const next = this.floor[r * this.cols + c];
      if (next - height > MOVE.stepSize + EPSILON) return false;
      height = next;
    }
    return true;
  }

  /** Parcourt les cases dont le centre est dans la boîte (agrandie de `margin`). */
  private forEachCell(box: THREE.Box3, margin: number, visit: (index: number) => void): void {
    const [c0, r0] = this.cellOf(box.min.x - margin, box.min.z - margin);
    const [c1, r1] = this.cellOf(box.max.x + margin, box.max.z + margin);
    for (let r = Math.max(r0, 0); r <= Math.min(r1, this.rows - 1); r++) {
      for (let c = Math.max(c0, 0); c <= Math.min(c1, this.cols - 1); c++) {
        const x = this.originX + (c + 0.5) * CELL;
        const z = this.originZ + (r + 0.5) * CELL;
        if (x > box.min.x - margin && x < box.max.x + margin && z > box.min.z - margin && z < box.max.z + margin) {
          visit(r * this.cols + c);
        }
      }
    }
  }

  /** Voisins accessibles (8 directions, sans couper les coins, marche maximale vers le haut). */
  private forEachNeighbor(index: number, visit: (next: number, cost: number) => void): void {
    const cc = index % this.cols;
    const cr = (index - cc) / this.cols;
    const from = this.floor[index];
    const canEnter = (c: number, r: number) =>
      this.free(c, r) && this.floor[r * this.cols + c] - from <= MOVE.stepSize + EPSILON;

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        if (!canEnter(cc + dc, cr + dr)) continue;
        if (dc !== 0 && dr !== 0 && (!canEnter(cc + dc, cr) || !canEnter(cc, cr + dr))) continue;
        visit((cr + dr) * this.cols + cc + dc, dc !== 0 && dr !== 0 ? SQRT2 : 1);
      }
    }
  }

  /** Repère toutes les cases qu'on peut atteindre en marchant depuis `start`. */
  private markReachable(start: THREE.Vector3): void {
    const first = this.nearestFree(...this.cellOf(start.x, start.z));
    if (first === null) return;
    const queue = [first];
    this.reachable[first] = 1;
    while (queue.length > 0) {
      const index = queue.pop()!;
      this.reachableCells.push(index);
      this.forEachNeighbor(index, (next) => {
        if (this.reachable[next]) return;
        this.reachable[next] = 1;
        queue.push(next);
      });
    }
  }

  private unwind(parent: Int32Array, goal: number): THREE.Vector3[] {
    const path: THREE.Vector3[] = [];
    for (let i = goal; i !== -1; i = parent[i]) path.push(this.center(i));
    return path.reverse();
  }

  /** Retire les points de passage inutiles : on va directement au plus loin visible. */
  private smooth(path: THREE.Vector3[], from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    const [tc, tr] = this.cellOf(to.x, to.z);
    if (this.usable(tc, tr)) path[path.length - 1] = new THREE.Vector3(to.x, this.floor[tr * this.cols + tc], to.z);
    const result: THREE.Vector3[] = [];
    let anchor = from;
    let i = 0;
    while (i < path.length) {
      let farthest = i;
      for (let j = path.length - 1; j > i; j--) {
        if (this.hasClearLine(anchor, path[j])) {
          farthest = j;
          break;
        }
      }
      anchor = path[farthest];
      result.push(anchor);
      i = farthest + 1;
    }
    return result;
  }

  /** Case libre et atteignable la plus proche (pour un joueur perché sur une caisse, par exemple). */
  private nearestUsable(c: number, r: number): number | null {
    return this.nearest(c, r, (cc, rr) => this.usable(cc, rr));
  }

  private nearestFree(c: number, r: number): number | null {
    return this.nearest(c, r, (cc, rr) => this.free(cc, rr));
  }

  private nearest(c: number, r: number, accept: (c: number, r: number) => boolean): number | null {
    for (let radius = 0; radius < 12; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
          if (accept(c + dc, r + dr)) return (r + dr) * this.cols + (c + dc);
        }
      }
    }
    return null;
  }

  private heuristic(a: number, b: number): number {
    const ac = a % this.cols;
    const bc = b % this.cols;
    const dx = Math.abs(ac - bc);
    const dz = Math.abs((a - ac) / this.cols - (b - bc) / this.cols);
    return dx + dz + (SQRT2 - 2) * Math.min(dx, dz);
  }

  private cellOf(x: number, z: number): [number, number] {
    return [Math.floor((x - this.originX) / CELL), Math.floor((z - this.originZ) / CELL)];
  }

  private center(index: number): THREE.Vector3 {
    const c = index % this.cols;
    const r = (index - c) / this.cols;
    return new THREE.Vector3(this.originX + (c + 0.5) * CELL, this.floor[index], this.originZ + (r + 0.5) * CELL);
  }

  private inside(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
  }

  private free(c: number, r: number): boolean {
    return this.inside(c, r) && !this.blocked[r * this.cols + c];
  }

  private usable(c: number, r: number): boolean {
    return this.free(c, r) && this.reachable[r * this.cols + c] === 1;
  }
}

/** File de priorité minimale pour A*. */
class MinHeap {
  private readonly items: number[] = [];
  private readonly priorities: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, priority: number): void {
    this.items.push(item);
    this.priorities.push(priority);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.priorities[p] <= this.priorities[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastPriority = this.priorities.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.priorities[0] = lastPriority;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.items.length && this.priorities[l] < this.priorities[smallest]) smallest = l;
        if (r < this.items.length && this.priorities[r] < this.priorities[smallest]) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.priorities[a], this.priorities[b]] = [this.priorities[b], this.priorities[a]];
  }
}
