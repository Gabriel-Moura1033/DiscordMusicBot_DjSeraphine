import type { SeekResult } from '../player/GuildPlayer.js';

/** Mensagem de erro de um /seek ou /replay que não deu certo; `null` = deu certo. */
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
      return `❌ Não consegui mudar a posição: ${result.error.userMessage}. A música continua de onde estava.`;
  }
}

