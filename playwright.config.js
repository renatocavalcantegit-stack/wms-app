// Testes de ponta a ponta (pasta e2e/): abrem as telas num navegador automático, tocam nos botões
// e conferem se o que uma tela faz aparece certo nas outras. Rodar: npm run e2e
// (os testes das regras continuam no npm test, sem navegador).
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.js",
  timeout: 90_000,
  // um de cada vez: cada teste é um fluxo longo e fica mais fácil de ler o que falhou
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5175",
    // sem service worker: o teste sempre usa os arquivos da pasta, nunca uma cópia guardada
    serviceWorkers: "block",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
  // servidor próprio dos testes (e2e/servidor.js), numa porta só dele
  webServer: {
    command: "node e2e/servidor.js",
    url: "http://localhost:5175",
    reuseExistingServer: false,
  },
});
