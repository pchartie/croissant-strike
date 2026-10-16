import * as THREE from 'three';
import type { PropPlacement } from './props';
import type { MapMaterial } from './MapVisuals';
import dunes from '../maps/dunes.json';
import medina from '../maps/medina.json';

// Les cartes du jeu. Maillage, éclairage, collisions et objets sont produits par Blender
// (map/<id>/build.py, `npm run build-map -- <id>`) ; le reste est décrit ici.

export type MapId = 'dunes' | 'medina';

/** Ce que Blender produit pour une carte (src/maps/<id>.json). */
interface MapData {
  /** Valeur d'éclairage d'un pixel blanc de la carte d'éclairage (voir map/lib/bake.py). */
  lightmapScale: number;
  /** Matériaux du maillage, par nom (map/lib/kit.py). */
  materials: Record<string, MapMaterial>;
  collisions: { min: number[]; max: number[]; surface: string }[];
  props: PropPlacement[];
}

export interface GameMap {
  id: MapId;
  label: string;
  data: MapData;
  /** Zone jouable (les bots naviguent dedans). */
  bounds: THREE.Box3;
  /** Apparition du joueur : au sud, face au nord. */
  spawn: { position: THREE.Vector3; yaw: number };
  /** Mode manches : les ennemis apparaissent au nord de `enemyZ`, les coéquipiers au sud de `allyZ`. */
  roundSpawnZ: { enemy: number; ally: number };
}

export const MAPS: Record<MapId, GameMap> = {
  dunes: {
    id: 'dunes',
    label: 'Dunes (grise)',
    data: dunes as unknown as MapData,
    bounds: new THREE.Box3(new THREE.Vector3(-36, 0, -36), new THREE.Vector3(36, 7, 36)),
    spawn: { position: new THREE.Vector3(0, 0, 31), yaw: 0 },
    roundSpawnZ: { enemy: -26, ally: 24 },
  },
  medina: {
    id: 'medina',
    label: 'Médina',
    data: medina as unknown as MapData,
    bounds: new THREE.Box3(new THREE.Vector3(-40, 0, -46), new THREE.Vector3(40, 8, 46)),
    spawn: { position: new THREE.Vector3(0, 0, 40), yaw: 0 },
    roundSpawnZ: { enemy: -35, ally: 35 },
  },
};
