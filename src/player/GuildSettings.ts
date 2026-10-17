import type { FilterName } from '../audio/filters.js';
import type { LoopMode } from './Queue.js';

/**
 * Preferências por guild. Sobrevivem ao player (saída do canal) no `PlayerManager` e ao restart
 * no SQLite (ADR-042). O player aplica ao conectar e o `PlayerManager` copia de volta a cada sincronização.
 */
export interface GuildSettings {
  filter: FilterName;
  loopMode: LoopMode;
  autoplay: boolean;
  volume: number;
}
