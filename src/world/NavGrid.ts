import * as THREE from 'three';

const CELL = 0.5;
/** Seuls les obstacles à hauteur de pieds bloquent le passage (le sol, lui, ne bloque pas). */
const FOOT_LEVEL = 0.4;
const SQRT2 = Math.SQRT2;

/**
 * Grille de navigation pour les bots : le sol découpé en cases de 50 cm,
 * marquées libres ou bloquées, et une recherche de chemin A* dessus.
 */
export class NavGrid {
  private readonly cols: number;
  private readonly rows: number;
  private readonly originX: number;
  private readonly originZ: number;
  private readonly blocked: Uint8Array;

  constructor(colliders: readonly THREE.Box3[], bounds: THREE.Box3, clearance: number) {
    this.originX = bounds.min.x;
    this.originZ = bounds.min.z;
    this.cols = Math.ceil((bounds.max.x - bounds.min.x) / CELL);
    this.rows = Math.ceil((bounds.max.z - bounds.min.z) / CELL);
    this.blocked = new Uint8Array(this.cols * this.rows);

    // Une case est bloquée si un bot centré dessus toucherait un obstacle.
    for (const box of colliders) {
      if (box.max.y <= 0.01 || box.min.y > FOOT_LEVEL) continue;
      const [c0, r0] = this.cellOf(box.min.x - clearance, box.min.z - clearance);
      const [c1, r1] = this.cellOf(box.max.x + clearance, box.max.z + clearance);
      for (let r = Math.max(r0, 0); r <= Math.min(r1, this.rows - 1); r++) {
        for (let c = Math.max(c0, 0); c <= Math.min(c1, this.cols - 1); c++) {
          const x = this.originX + (c + 0.5) * CELL;
          const z = this.originZ + (r + 0.5) * CELL;
          if (x > box.min.x - clearance && x < box.max.x + clearance && z > box.min.z - clearance && z < box.max.z + clearance) {
            this.blocked[r * this.cols + c] = 1;
          }
        }
      }
    }
  }

  isWalkable(x: number, z: number): boolean {
    const [c, r] = this.cellOf(x, z);
    return this.inside(c, r) && !this.blocked[r * this.cols + c];
  }

  randomWalkablePoint(): THREE.Vector3 {
    for (;;) {
      const c = Math.floor(Math.random() * this.cols);
      const r = Math.floor(Math.random() * this.rows);
      if (!this.blocked[r * this.cols + c]) return this.center(c, r);
    }
  }

  /** Chemin de `from` à `to` sous forme de points de passage, ou null si inaccessible. */
  findPath(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] | null {
    const start = this.nearestFree(...this.cellOf(from.x, from.z));
    const goal = this.nearestFree(...this.cellOf(to.x, to.z));
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

      const cc = current % this.cols;
      const cr = (current - cc) / this.cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dc === 0 && dr === 0) continue;
          const nc = cc + dc;
          const nr = cr + dr;
          if (!this.free(nc, nr)) continue;
          // Pas de coupe en diagonale à travers un coin d'obstacle.
          if (dc !== 0 && dr !== 0 && (!this.free(cc + dc, cr) || !this.free(cc, cr + dr))) continue;
          const next = nr * this.cols + nc;
          const newCost = cost[current] + (dc !== 0 && dr !== 0 ? SQRT2 : 1);
          if (newCost < cost[next]) {
            cost[next] = newCost;
            parent[next] = current;
            open.push(next, newCost + this.heuristic(next, goal));
          }
        }
      }
    }
    return null;
  }

  /** Vrai si on peut aller en ligne droite de a à b sans traverser de case bloquée. */
  hasClearLine(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const distance = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(distance / (CELL * 0.5));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!this.isWalkable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  }

  private unwind(parent: Int32Array, goal: number): THREE.Vector3[] {
    const path: THREE.Vector3[] = [];
    for (let i = goal; i !== -1; i = parent[i]) {
      const c = i % this.cols;
      path.push(this.center(c, (i - c) / this.cols));
    }
    return path.reverse();
  }

  /** Retire les points de passage inutiles : on va directement au plus loin visible. */
  private smooth(path: THREE.Vector3[], from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    if (this.isWalkable(to.x, to.z)) path[path.length - 1] = new THREE.Vector3(to.x, 0, to.z);
    const result: THREE.Vector3[] = [];
    let anchor = new THREE.Vector3(from.x, 0, from.z);
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

  private nearestFree(c: number, r: number): number | null {
    for (let radius = 0; radius < 6; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (this.free(c + dc, r + dr)) return (r + dr) * this.cols + (c + dc);
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

  private center(c: number, r: number): THREE.Vector3 {
    return new THREE.Vector3(this.originX + (c + 0.5) * CELL, 0, this.originZ + (r + 0.5) * CELL);
  }

  private inside(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
  }

  private free(c: number, r: number): boolean {
    return this.inside(c, r) && !this.blocked[r * this.cols + c];
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
