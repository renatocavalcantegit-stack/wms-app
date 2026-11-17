// PIN dos usuários: o banco guarda só um "resumo" (hash) do PIN, nunca o PIN.
// Usa o scrypt, que já vem no Node e é lento de propósito, para dificultar tentativas em massa.
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

// devolve "sal:hash". O sal é aleatório, então dois usuários com o mesmo PIN ficam com textos diferentes.
export function gerarHash(pin) {
  const sal = randomBytes(16).toString("hex");
  const hash = scryptSync(String(pin), sal, 32).toString("hex");
  return `${sal}:${hash}`;
}

// o PIN digitado gera o mesmo hash que está guardado?
export function conferirPin(pin, guardado) {
  const [sal, hash] = String(guardado).split(":");
  if (!sal || !hash) return false;
  const calculado = scryptSync(String(pin), sal, 32);
  // timingSafeEqual compara em tempo constante (não dá pistas de quantos caracteres acertou)
  return timingSafeEqual(calculado, Buffer.from(hash, "hex"));
}
