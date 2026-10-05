import * as THREE from 'three';

const MAX_TRACERS = 32;
const LIFE = 0.07;

/** Traînées lumineuses des balles, pour voir d'où viennent les tirs ennemis. */
export class Tracers {
  private readonly lines: { line: THREE.Line; life: number }[] = [];
  private next = 0;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < MAX_TRACERS; i++) {
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const material = new THREE.LineBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0 });
      const line = new THREE.Line(geometry, material);
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.lines.push({ line, life: 0 });
    }
  }

  add(from: THREE.Vector3, to: THREE.Vector3): void {
    const tracer = this.lines[this.next];
    this.next = (this.next + 1) % MAX_TRACERS;
    const position = tracer.line.geometry.attributes.position as THREE.BufferAttribute;
    position.setXYZ(0, from.x, from.y, from.z);
    position.setXYZ(1, to.x, to.y, to.z);
    position.needsUpdate = true;
    tracer.life = LIFE;
    tracer.line.visible = true;
  }

  update(dt: number): void {
    for (const tracer of this.lines) {
      if (tracer.life <= 0) continue;
      tracer.life -= dt;
      tracer.line.visible = tracer.life > 0;
      (tracer.line.material as THREE.LineBasicMaterial).opacity = Math.max(tracer.life / LIFE, 0) * 0.8;
    }
  }
}
