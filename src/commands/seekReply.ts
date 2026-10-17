import type { SeekResult } from '../player/GuildPlayer.js';

/** Mensagem de erro de /seek, /replay ou /filtro (todos reabrem o stream); `null` = deu certo. */
export function seekFailureMessage(result: SeekResult): string | null {
  switch (result.status) {
    case 'ok':
      return null;
    case 'idle':
      return 'Não há nada tocando.';
    case 'busy':
      return 'Estou trocando de faixa agora; tente de novo em instantes.';
    case 'superseded':
      return 'A faixa mudou (ou outro pedido de posição chegou) antes de eu terminar.';
    case 'failed':
      return `❌ Não consegui reabrir o áudio: ${result.error.userMessage}. A música continua de onde estava.`;
  }
}

