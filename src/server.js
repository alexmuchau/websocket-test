const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws'); // Importa o servidor WebSocket nativo
const url = require('url');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server }); // Anexa o WebSocket Server ao servidor HTTP

// === ARMAZENAMENTO EM MEMÓRIA ===
let reservations = [];
// Usamos um Map para associar cada conexão WebSocket (ws) aos dados do usuário
let clients = new Map(); 

// === FUNÇÕES AUXILIARES ===

const generateUniqueId = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

// Função para enviar uma mensagem para todos os clientes conectados
const broadcast = (data) => {
  const message = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // 1 significa WebSocket.OPEN
      client.send(message);
    }
  });
};

const emitOnlineUsersUpdate = () => {
  const uniqueUserEmails = [...new Set(Array.from(clients.values()).map(user => user.email))];
  broadcast({
    type: 'ONLINE_USERS_UPDATED',
    payload: uniqueUserEmails
  });
  console.log('Lista de usuários online emitida:', uniqueUserEmails);
};

const emitReservationsUpdate = () => {
  broadcast({
    type: 'RESERVATIONS_UPDATED',
    payload: reservations
  });
  console.log('Estado das reservas atualizado e emitido:', reservations.length);
};

// === LÓGICA DE NEGÓCIO (permanece a mesma) ===
setInterval(() => {
  const now = new Date();
  const initialCount = reservations.length;
  reservations = reservations.filter(res => {
    if (res.status === 'reserved' && new Date(res.expires_at) <= now) {
      console.log(`Reserva do número ${res.number} expirou.`);
      return false;
    }
    return true;
  });
  if (reservations.length < initialCount) {
    emitReservationsUpdate();
  }
}, 5000);

// === GERENCIAMENTO DE CONEXÕES WEBSOCKET ===

wss.on('connection', (ws, req) => {
  // Extrai parâmetros da URL de conexão (ex: ws://.../?user_email=a@b.com&user_name=Teste)
  const parameters = new URL(req.url, `http://${req.headers.host}`).searchParams;
  const user_email = parameters.get('user_email');
  const user_name = parameters.get('user_name');
  
  console.log(`Cliente conectado: ${user_name} (${user_email})`);
  clients.set(ws, { email: user_email, name: user_name });

  // Envia o estado inicial para o cliente recém-conectado
  ws.send(JSON.stringify({ type: 'INITIAL_STATE', payload: reservations }));
  
  // Notifica a todos sobre a nova lista de usuários online
  emitOnlineUsersUpdate();

  // Lida com mensagens recebidas do cliente
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      const { type, payload } = data;
      const currentUser = clients.get(ws);

      // Roteia a ação com base no tipo da mensagem
      switch (type) {
        case 'TOGGLE_NUMBER_RESERVATION':
          console.log('Evento TOGGLE recebido:', payload);
          const { number } = payload;
          const existing = reservations.find(r => r.number === number);
          if (existing) {
            if (existing.user_email === currentUser.email) {
              reservations = reservations.filter(r => r.number !== number);
            }
          } else {
            const reserved_at = new Date();
            reservations.push({
              id: generateUniqueId(),
              number,
              user_name: currentUser.name,
              user_email: currentUser.email,
              status: 'reserved',
              reserved_at: reserved_at.toISOString(),
              expires_at: new Date(reserved_at.getTime() + 60 * 1000).toISOString()
            });
          }
          emitReservationsUpdate();
          break;

        case 'PURCHASE_MY_RESERVATIONS':
          console.log('Evento PURCHASE recebido:', payload);
          reservations.forEach(res => {
            if (res.status === 'reserved' && res.user_email === currentUser.email) {
              res.status = 'purchased';
              res.purchased_at = new Date().toISOString();
              delete res.expires_at;
            }
          });
          emitReservationsUpdate();
          break;
      }
    } catch (e) {
      console.error('Erro ao processar mensagem:', e);
    }
  });

  // Lida com a desconexão
  ws.on('close', () => {
    console.log(`Cliente desconectado: ${user_name} (${user_email})`);
    clients.delete(ws);
    emitOnlineUsersUpdate();
  });

  ws.on('error', (error) => {
    console.error('Erro no WebSocket:', error);
  });
});

const PORT = process.env.PORT || 3333;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});