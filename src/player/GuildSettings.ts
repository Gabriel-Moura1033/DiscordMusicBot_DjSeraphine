import type { FilterName } from '../audio/filters.js';

/** Preferências por guild que sobrevivem ao player (saída do canal); persistidas na Fase 6. */
export interface GuildSettings {
  filter: FilterName;
}
