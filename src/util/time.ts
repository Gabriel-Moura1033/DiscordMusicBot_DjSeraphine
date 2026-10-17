/** Converte `ss`, `mm:ss` ou `hh:mm:ss` em segundos. Minutos e segundos depois do primeiro campo vão de 00 a 59. */
export function parseTimestamp(raw: string): number | null {
  const parts = raw.trim().split(':');
  if (parts.length < 1 || parts.length > 3) return null;
  if (!parts.every((part) => /^\d{1,6}$/.test(part))) return null;
  const numbers = parts.map(Number);
  // Só o primeiro campo pode passar de 59 ("90" ou "90:00" são aceitos).
  if (numbers.slice(1).some((value) => value > 59)) return null;
  if (parts.slice(1).some((part) => part.length !== 2)) return null;
  return numbers.reduce((total, value) => total * 60 + value, 0);
}
