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

// O Chrome só deixa tocar som depois de um toque ou tecla NA PÁGINA (depois de recarregar, conta de novo).
// O som do pedido novo chega sozinho, sem toque: por isso o primeiro toque ou tecla em qualquer lugar já liga o áudio.
function liberarSom() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
  } catch {}
}
if (typeof document !== "undefined") {
  for (const ev of ["pointerdown", "keydown", "touchstart"]) document.addEventListener(ev, liberarSom, { capture: true, passive: true });
}

// toque de PEDIDO NOVO NA FILA (Fase 1e): o coordenador mandou pedido para este separador.
// Só som (e vibração), sem notificação. Três notas subindo, duas vezes; bem diferente do bipe da leitura.
// O navegador só toca som depois de um toque na tela: no coletor isso já aconteceu no login.
export function somDePedidoNovo() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    const notas = [659, 831, 988]; // mi, sol sustenido, si
    [0, 0.75].forEach((rodada) => notas.forEach((f, i) => {
      const t = actx.currentTime + rodada + i * 0.16;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = "triangle"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.34);
    }));
  } catch {}
  vibrate([120, 80, 120, 80, 240]);
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

// ---------- teclado físico travado no modo Fn ----------
// No coletor (ex.: Chainway C6000), com o modo Fn ligado as teclas 1 a 6 viram F1…F6 — inclusive os
// números que o LEITOR "digita": o código chega pela metade e o Chrome abre a ajuda (F1).
// Só F1…F6 indicam o Fn travado (o teclado do C6000 só tem essas). As outras teclas F são ignoradas:
// o próprio gatilho SCAN envia F9 (KeyCode 139 no app do leitor) antes de cada código.
// Com F1…F6: avisa, tenta impedir o efeito da tecla no navegador e descarta o bipe estragado.
let fnQuando = 0, fnAviso = 0;
document.addEventListener("keydown", (e) => {
  if (!/^F[1-6]$/.test(e.key)) return;
  e.preventDefault();
  fnQuando = Date.now();
  const i = document.activeElement;
  if (i && i.matches("input")) i.value = ""; // o que já entrou deste bipe está incompleto
  if (Date.now() - fnAviso > 3000) { fnAviso = Date.now(); toast("TECLADO NO MODO Fn · aperte Num para voltar aos números e bipe de novo"); beep(false); vibrate([80, 50, 80]); }
}, true);
// o Enter do fim do bipe estragado não confirma nada (o campo já foi limpo e o aviso já apareceu)
document.addEventListener("submit", (e) => {
  if (Date.now() - fnQuando > 2000) return;
  e.preventDefault(); e.stopImmediatePropagation();
  e.target.querySelectorAll("input").forEach((i) => (i.value = ""));
}, true);

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
