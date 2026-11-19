// WMS Beach Bike — toque de PEDIDO NOVO NA FILA (Fase 1e), usado pelo coletor (Separação) e pelo posto (Conferência).
// O coordenador mandou pedido para esta pessoa. Só som (e vibração), sem notificação.
// Três notas subindo, uma vez; bem diferente do bipe da leitura.
let actx;
const contexto = () => (actx = actx || new (window.AudioContext || window.webkitAudioContext)());

// O Chrome só deixa tocar som depois de um toque ou tecla NA PÁGINA (depois de recarregar, conta de novo).
// O som do pedido novo chega sozinho, sem toque: por isso o primeiro toque ou tecla em qualquer lugar já liga o áudio.
function liberarSom() {
  try { if (contexto().state === "suspended") actx.resume(); } catch {}
}
if (typeof document !== "undefined") {
  for (const ev of ["pointerdown", "keydown", "touchstart"]) document.addEventListener(ev, liberarSom, { capture: true, passive: true });
}

export function somDePedidoNovo() {
  try {
    contexto();
    if (actx.state === "suspended") actx.resume();
    const notas = [659, 831, 988]; // mi, sol sustenido, si
    notas.forEach((f, i) => {
      const t = actx.currentTime + i * 0.16;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = "triangle"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.34);
    });
  } catch {}
  if (navigator.vibrate) navigator.vibrate([120, 80, 240]);
}
