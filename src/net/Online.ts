import type { DataConnection, Peer } from 'peerjs';
import { isMessage, PROTOCOL_VERSION, type NetMessage } from './protocol';

export type OnlineStatus =
  | { kind: 'idle' }
  /** Partie créée : on attend l'adversaire avec ce code. */
  | { kind: 'hosting'; code: string }
  | { kind: 'joining'; code: string }
  | { kind: 'connected'; code: string; opponent: string }
  | { kind: 'error'; message: string };

/** Préfixe des identifiants sur le serveur de mise en relation public de PeerJS. */
const ID_PREFIX = 'fps1-duel-';
/** Lettres et chiffres sans ambiguïté (pas de O/0, I/1…) pour un code facile à dicter. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const JOIN_TIMEOUT_MS = 15000;

/**
 * Connexion directe entre deux navigateurs (WebRTC, via PeerJS) : l'un crée une
 * partie et reçoit un code, l'autre la rejoint avec ce code. Le serveur public
 * de PeerJS ne sert qu'à se trouver ; ensuite tout passe de navigateur à navigateur.
 */
export class Online {
  private peer: Peer | null = null;
  private connection: DataConnection | null = null;
  private current: OnlineStatus = { kind: 'idle' };
  private statusListeners: ((status: OnlineStatus) => void)[] = [];
  private messageListeners: ((message: NetMessage) => void)[] = [];
  private joinTimer = 0;
  /** Change à chaque nouvelle tentative, pour ignorer les événements d'une connexion abandonnée. */
  private attempt = 0;

  get status(): OnlineStatus {
    return this.current;
  }

  get connected(): boolean {
    return this.current.kind === 'connected';
  }

  onStatus(listener: (status: OnlineStatus) => void): void {
    this.statusListeners.push(listener);
  }

  onMessage(listener: (message: NetMessage) => void): void {
    this.messageListeners.push(listener);
  }

  /** Crée une partie ; le code à donner à l'adversaire arrive avec le statut `hosting`. */
  async host(name: string): Promise<void> {
    const attempt = this.restart();
    const code = randomCode();
    const peer = await this.createPeer(ID_PREFIX + code, attempt);
    if (!peer) return;
    peer.on('open', () => this.isCurrent(attempt) && this.setStatus({ kind: 'hosting', code }));
    peer.on('connection', (connection) => {
      // Une seule partie à la fois : on refuse un deuxième adversaire.
      if (!this.isCurrent(attempt) || this.connection) {
        connection.close();
        return;
      }
      this.attach(connection, code, name, attempt);
    });
    peer.on('error', (error) => {
      if (!this.isCurrent(attempt)) return;
      // Code déjà pris par une autre partie : on en tire un autre.
      if (error.type === 'unavailable-id') void this.host(name);
      else this.fail(errorMessage(error.type));
    });
  }

  /** Rejoint la partie de ce code. */
  async join(rawCode: string, name: string): Promise<void> {
    const code = rawCode.trim().toUpperCase();
    if (code.length !== CODE_LENGTH || [...code].some((c) => !CODE_ALPHABET.includes(c))) {
      this.setStatus({ kind: 'error', message: `Le code fait ${CODE_LENGTH} lettres ou chiffres` });
      return;
    }
    const attempt = this.restart();
    this.setStatus({ kind: 'joining', code });
    const peer = await this.createPeer(undefined, attempt);
    if (!peer) return;
    peer.on('open', () => {
      if (!this.isCurrent(attempt)) return;
      this.attach(peer.connect(ID_PREFIX + code, { serialization: 'json', reliable: true }), code, name, attempt);
      this.joinTimer = window.setTimeout(() => {
        if (this.isCurrent(attempt) && !this.connected) this.fail("Pas de réponse de l'autre joueur");
      }, JOIN_TIMEOUT_MS);
    });
    peer.on('error', (error) => this.isCurrent(attempt) && this.fail(errorMessage(error.type)));
  }

  send(message: NetMessage): void {
    if (this.connected) this.connection?.send(message);
  }

  /** Quitte la partie (ou annule l'attente). */
  leave(): void {
    this.restart();
    this.setStatus({ kind: 'idle' });
  }

  private async createPeer(id: string | undefined, attempt: number): Promise<Peer | null> {
    try {
      // Chargé seulement quand on joue en ligne.
      const { Peer } = await import('peerjs');
      if (!this.isCurrent(attempt)) return null;
      this.peer = id ? new Peer(id) : new Peer();
      return this.peer;
    } catch {
      this.fail('Impossible de charger la connexion en ligne');
      return null;
    }
  }

  private attach(connection: DataConnection, code: string, name: string, attempt: number): void {
    this.connection = connection;
    connection.on('open', () => {
      if (this.isCurrent(attempt)) connection.send({ t: 'hello', version: PROTOCOL_VERSION, name } satisfies NetMessage);
    });
    connection.on('data', (data) => {
      if (!this.isCurrent(attempt) || !isMessage(data)) return;
      if (data.t === 'hello') {
        if (data.version !== PROTOCOL_VERSION) {
          this.fail("L'autre joueur n'a pas la même version du jeu (rechargez la page tous les deux)");
          return;
        }
        window.clearTimeout(this.joinTimer);
        this.setStatus({ kind: 'connected', code, opponent: cleanName(data.name) });
        return;
      }
      if (this.connected) for (const listener of this.messageListeners) listener(data);
    });
    connection.on('close', () => this.isCurrent(attempt) && this.fail("L'autre joueur est parti"));
    connection.on('error', () => this.isCurrent(attempt) && this.fail('Connexion perdue'));
  }

  /** Ferme tout ce qui existe et démarre une nouvelle tentative. */
  private restart(): number {
    window.clearTimeout(this.joinTimer);
    this.connection?.close();
    this.peer?.destroy();
    this.connection = null;
    this.peer = null;
    return ++this.attempt;
  }

  private isCurrent(attempt: number): boolean {
    return attempt === this.attempt;
  }

  private fail(message: string): void {
    this.restart();
    this.setStatus({ kind: 'error', message });
  }

  private setStatus(status: OnlineStatus): void {
    this.current = status;
    for (const listener of this.statusListeners) listener(status);
  }
}

function randomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

/** Pseudo affiché : court et sans caractères de contrôle. */
export function cleanName(name: unknown): string {
  const text = typeof name === 'string' ? name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 16) : '';
  return text || 'Adversaire';
}

function errorMessage(type: string): string {
  switch (type) {
    case 'peer-unavailable':
      return 'Aucune partie avec ce code';
    case 'browser-incompatible':
      return 'Ce navigateur ne permet pas de jouer en ligne';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Serveur de mise en relation injoignable (connexion Internet ?)';
    case 'webrtc':
      return 'Connexion directe impossible (réseau trop restrictif ?)';
    default:
      return `Erreur de connexion (${type})`;
  }
}
