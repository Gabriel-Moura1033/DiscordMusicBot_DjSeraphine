import type { FilterName } from '../audio/filters.js';

/** Preferências por guild que sobrevivem ao player (saída do canal), só em memória: perdidas no restart. */
export interface GuildSettings {
  filter: FilterName;
}
