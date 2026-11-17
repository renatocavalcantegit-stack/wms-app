// Liga o servidor do WMS. Uso: npm run iniciar (ou npm run dev, que reinicia ao salvar um arquivo)
import { conectar } from "./banco.js";
import { criarServidor } from "./servidor.js";

const pool = conectar();
const app = criarServidor({ pool, registrarLog: true });
const porta = Number(process.env.PORTA) || 3000;

await app.listen({ port: porta, host: "0.0.0.0" }); // 0.0.0.0: os coletores da rede também alcançam

// Ctrl+C: fecha as conexões antes de sair
process.on("SIGINT", async () => {
  await app.close();
  await pool.end();
  process.exit(0);
});
