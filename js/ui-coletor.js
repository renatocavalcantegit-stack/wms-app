// WMS Beach Bike — utilitários de tela do app do coletor (index.html): Separação e Embarque.
import { $, $$ } from "./util.js";
import { session } from "./sessao.js";

export const vibrate = (p) => navigator.vibrate && navigator.vibrate(p);
export const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>';

// nome de quem está logado neste aparelho
export const getUser = () => (session() || {}).nome || "";

// aviso curto no rodapé da tela
let toastT;
export function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2200);
}

// feedback sonoro curto (bipe)
let actx;
export function beep(ok = true) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = ok ? 1320 : 220; o.type = ok ? "sine" : "square";
    g.gain.setValueAtTime(0.12, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + (ok ? 0.12 : 0.3));
    o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + (ok ? 0.12 : 0.3));
  } catch {}
}

// telas permitidas por perfil (o login decide a tela; nada fora do perfil é exibido)
const ACCESS = { sep: ["viewSetor", "viewHome", "viewPick", "viewDone"], emb: ["viewEmbHome", "viewLoad", "viewLoadDone"] };
export function show(id) {
  const sess = session();
  if (id !== "viewLogin" && !(sess && (ACCESS[sess.perfil] || []).includes(id))) id = "viewLogin";
  $$(".view").forEach((v) => (v.hidden = v.id !== id));
  window.scrollTo(0, 0);
  document.querySelector('meta[name="theme-color"]').content = id === "viewLogin" ? "#ffffff" : "#F5F5F7";
}

// ---------- sheets (painéis que sobem do rodapé) ----------
export function openSheet(id) {
  $$(".sheet").forEach((s) => (s.hidden = s.id !== id));
  $("#scrim").hidden = false;
}
export function closeSheets() {
  $$(".sheet").forEach((s) => (s.hidden = true));
  $("#scrim").hidden = true;
}
$("#scrim").addEventListener("click", closeSheets);

// ---------- câmera (BarcodeDetector, quando disponível) ----------
let stream, detecting = false;
$$(".cam-btn").forEach((b) => (b.hidden = !("BarcodeDetector" in window)));
export async function openCam(onCode) {
  try {
    const det = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "code_128", "code_39", "qr_code", "upc_a"] });
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const v = $("#camVideo"); v.srcObject = stream; await v.play();
    $("#camView").hidden = false; detecting = true;
    const loop = async () => {
      if (!detecting) return;
      try {
        const r = await det.detect(v);
        if (r.length) { stopCam(); onCode(r[0].rawValue); return; }
      } catch {}
      requestAnimationFrame(loop);
    };
    loop();
  } catch { toast("Não foi possível abrir a câmera"); stopCam(); }
}
function stopCam() {
  detecting = false;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null; $("#camView").hidden = true;
}
$("#camClose").addEventListener("click", stopCam);
