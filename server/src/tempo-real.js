// Tempo real com SSE (Server-Sent Events): o servidor avisa na hora quem está assistindo (ex.: a Gestão).
// O navegador abre uma conexão HTTP que fica aberta (EventSource) e o servidor escreve eventos nela.
// Formato de cada evento no fio:   event: <nome>\n data: <json>\n\n

export function criarCanalTempoReal() {
  const conectados = new Set(); // respostas HTTP abertas, uma por tela assistindo

  // a cada 25 s manda um comentário vazio, para proxies e o Wi-Fi não derrubarem a conexão parada
  const batimento = setInterval(() => {
    for (const resposta of conectados) resposta.write(": batimento\n\n");
  }, 25_000);

  return {
    // abre a conexão de uma tela; ela fica na lista até o navegador fechar
    conectar(request, reply) {
      reply.hijack(); // a partir daqui a resposta é escrita "na mão", sem o Fastify fechar
      const resposta = reply.raw;
      resposta.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      resposta.write(": conectado\n\n");
      conectados.add(resposta);
      request.raw.on("close", () => conectados.delete(resposta));
    },

    // manda um evento para todas as telas conectadas
    avisar(evento, dados) {
      const mensagem = `event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`;
      for (const resposta of conectados) resposta.write(mensagem);
    },

    quantosConectados: () => conectados.size,

    // desliga tudo (usado ao parar o servidor e nos testes)
    fechar() {
      clearInterval(batimento);
      for (const resposta of conectados) resposta.end();
      conectados.clear();
    },
  };
}
