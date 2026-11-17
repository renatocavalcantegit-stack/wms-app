// WMS Beach Bike — utilitários de tela do app do coletor: Separação e Embarque (index.html) e Estoque (estoque.html).
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
const ACCESS = {
  sep: ["viewSetor", "viewHome", "viewPick", "viewDoca", "viewDone"],
  emb: ["viewEmbHome", "viewLoad", "viewLoadDone"],
  estq: ["viewEstHome", "viewConsulta", "viewEmbalagem", "viewEnderecar", "viewRecConf", "viewRecArm", "viewRecCons", "viewAbast", "viewTransf", "viewInv"],
};
export function show(id) {
  const sess = session();
  if (id !== "viewLogin" && !(sess && (ACCESS[sess.perfil] || []).includes(id))) id = "viewLogin";
  $$(".view").forEach((v) => (v.hidden = v.id !== id));
  window.scrollTo(0, 0);
  document.querySelector('meta[name="theme-color"]').content = id === "viewLogin" ? "#ffffff" : "#F5F5F7";
  setTimeout(focarLeitura, 60);
}

// ---------- campo de bipe sempre pronto ----------
// Nos coletores, o gatilho do leitor (botões laterais e de trás) "digita" o código no campo que está com o foco.
// Por isso todo campo de bipe (marcado com data-leitura) já vem focado, e volta a ficar focado quando
// a pessoa fecha um painel ou toca numa parte vazia da tela.
export function focarLeitura() {
  if (!$("#scrim").hidden) return; // painel aberto (falta, lista…): o foco é dele
  const ativo = document.activeElement;
  if (ativo && ativo.matches("input:not([data-leitura]), textarea, select") && !ativo.disabled && ativo.offsetParent !== null) return; // está digitando outra coisa (ex.: quantidade)
  const tela = [...$$(".view")].find((v) => !v.hidden);
  const campo = tela && [...tela.querySelectorAll("input[data-leitura]")].find((i) => !i.disabled && i.offsetParent !== null);
  if (campo && campo !== ativo) campo.focus({ preventScroll: true });
}
// tocou numa parte vazia da tela (não em botão, campo ou link): o foco volta para o campo de bipe
document.addEventListener("click", (e) => {
  if (e.target.closest("input, textarea, select, button, a, label, .sheet")) return;
  setTimeout(focarLeitura, 0);
});
// voltou para o app (desbloqueou a tela, trocou de aplicativo)
document.addEventListener("visibilitychange", () => { if (!document.hidden) setTimeout(focarLeitura, 60); });

// ---------- teclado da tela só quando o usuário toca no campo ----------
// O coletor tem teclado físico e leitor: quando o app coloca o foco num campo sozinho (bipe, quantidade),
// o teclado da tela NÃO sobe (inputmode="none"), senão ele cobre metade da tela pequena.
// Se a pessoa TOCA no campo, o teclado volta (com o tipo certo: números ou texto).
let toqueEm = null, toqueQuando = 0;
const tecladoDe = (i) => i.dataset.teclado ?? (i.dataset.teclado = i.getAttribute("inputmode") || "");
function semTeclado(i) { tecladoDe(i); i.inputMode = "none"; }
function comTeclado(i) { const t = tecladoDe(i); if (t) i.inputMode = t; else i.removeAttribute("inputmode"); }
const ehCampo = (el) => el && el.matches && el.matches("input:not([type=checkbox]):not([type=radio]), textarea");
document.addEventListener("pointerdown", (e) => { toqueEm = e.target; toqueQuando = Date.now(); }, true);
document.addEventListener("focusin", (e) => {
  const i = e.target;
  if (!ehCampo(i)) return;
  const tocou = toqueEm === i && Date.now() - toqueQuando < 1500;
  if (tocou) comTeclado(i); else semTeclado(i);
}, true);
// tocou no campo que já estava focado (sem teclado): abre o teclado agora
document.addEventListener("click", (e) => {
  const i = e.target;
  if (!ehCampo(i) || document.activeElement !== i || i.inputMode !== "none") return;
  comTeclado(i); i.blur(); i.focus();
}, true);

// ---------- sheets (painéis que sobem do rodapé) ----------
export function openSheet(id) {
  $$(".sheet").forEach((s) => (s.hidden = s.id !== id));
  $("#scrim").hidden = false;
}
export function closeSheets() {
  $$(".sheet").forEach((s) => (s.hidden = true));
  $("#scrim").hidden = true;
  setTimeout(focarLeitura, 60);
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
