// Importa os módulos necessários
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// Inicializa o aplicativo Express
const app = express();
// Cria um servidor HTTP a partir do aplicativo Express
const server = http.createServer(app);
// Inicializa o Socket.IO para o servidor HTTP, permitindo CORS para qualquer origem
const io = new Server(server, {
  cors: {
    origin: "*", // Permite conexões de qualquer origem (para desenvolvimento)
    methods: ["GET", "POST"] // Métodos HTTP permitidos
  }
});

// Array para simular um banco de dados de reservas em memória
// Em um ambiente de produção, isso seria substituído por um banco de dados real (MongoDB, PostgreSQL, etc.)
let reservations = [];

// Função para gerar um ID único para cada reserva
const generateUniqueId = () => {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

// Função para emitir o estado atual das reservas para todos os clientes
const emitReservationsUpdate = () => {
  // Filtra reservas expiradas antes de emitir para garantir que o cliente veja o estado mais recente
  // Embora o monitor de expiração faça isso, é uma boa prática garantir a consistência
  reservations = reservations.filter(res => {
    if (res.status === 'reserved' && new Date() > new Date(res.expires_at)) {
      console.log(`Reserva do número ${res.number} para ${res.user_email} expirou e foi removida.`);
      return false; // Remove a reserva expirada
    }
    return true;
  });

  // Emite o evento RESERVATIONS_UPDATED para todos os clientes conectados
  io.emit('RESERVATIONS_UPDATED', {
    type: 'RESERVATIONS_UPDATED',
    payload: reservations.map(res => ({
      id: res.id,
      number: res.number,
      user_name: res.user_name,
      user_email: res.user_email,
      status: res.status,
      reserved_at: res.reserved_at,
      ...(res.status === 'reserved' && { expires_at: res.expires_at }), // Adiciona expires_at se status for 'reserved'
      ...(res.status === 'purchased' && { purchased_at: res.purchased_at }) // Adiciona purchased_at se status for 'purchased'
    }))
  });
  console.log('Estado das reservas atualizado e emitido:', reservations.length);
};

// Monitor de expiração de reservas
// Roda a cada 5 segundos para verificar e remover reservas expiradas
setInterval(() => {
  const now = new Date();
  let changed = false;
  reservations = reservations.filter(res => {
    if (res.status === 'reserved' && new Date(res.expires_at) <= now) {
      console.log(`Reserva do número ${res.number} para ${res.user_email} expirou.`);
      changed = true;
      return false; // Remove a reserva expirada
    }
    return true;
  });

  // Se alguma reserva foi removida, emite a atualização para todos os clientes
  if (changed) {
    emitReservationsUpdate();
  }
}, 5000); // Verifica a cada 5 segundos

// Lida com novas conexões WebSocket
io.on('connection', (socket) => {
  console.log(`Cliente conectado: ${socket.id}`);

  // Envia o estado inicial para o cliente recém-conectado
  socket.emit('INITIAL_STATE', {
    type: 'INITIAL_STATE',
    payload: reservations.map(res => ({
      id: res.id,
      number: res.number,
      user_name: res.user_name,
      user_email: res.user_email,
      status: res.status,
      reserved_at: res.reserved_at,
      ...(res.status === 'reserved' && { expires_at: res.expires_at }),
      ...(res.status === 'purchased' && { purchased_at: res.purchased_at })
    }))
  });
  console.log(`Estado inicial enviado para ${socket.id}`);

  // Lida com o evento TOGGLE_NUMBER_RESERVATION do cliente
  socket.on('TOGGLE_NUMBER_RESERVATION', (data) => {
    console.log('Evento TOGGLE_NUMBER_RESERVATION recebido:', data);
    const { number, user_email, user_name } = data.payload;

    // Encontra a reserva existente para o número clicado
    const existingReservation = reservations.find(res => res.number === number);

    if (existingReservation) {
      // Se o número está reservado pelo mesmo usuário, libera
      if (existingReservation.status === 'reserved' && existingReservation.user_email === user_email) {
        reservations = reservations.filter(res => res.number !== number);
        console.log(`Reserva do número ${number} liberada por ${user_email}.`);
      }
      // Se o número está reservado por outro usuário ou já foi comprado, ignora
      else if (existingReservation.status === 'reserved' && existingReservation.user_email !== user_email) {
        console.log(`Número ${number} já reservado por outro usuário (${existingReservation.user_email}). Requisição ignorada.`);
      }
      else if (existingReservation.status === 'purchased') {
        console.log(`Número ${number} já comprado. Requisição ignorada.`);
      }
    } else {
      // Se o número está disponível, cria uma nova reserva
      const reserved_at = new Date();
      const expires_at = new Date(reserved_at.getTime() + 60 * 1000); // Expira em 1 minuto
      const newReservation = {
        id: generateUniqueId(),
        number,
        user_name,
        user_email,
        status: 'reserved',
        reserved_at: reserved_at.toISOString(),
        expires_at: expires_at.toISOString()
      };
      reservations.push(newReservation);
      console.log(`Número ${number} reservado por ${user_email}.`);
    }

    // Após qualquer alteração, emite a atualização para todos os clientes
    emitReservationsUpdate();
  });

  // Lida com o evento PURCHASE_MY_RESERVATIONS do cliente
  socket.on('PURCHASE_MY_RESERVATIONS', (data) => {
    console.log('Evento PURCHASE_MY_RESERVATIONS recebido:', data);
    const { user_email } = data.payload;
    let changed = false;

    // Localiza e atualiza todas as reservas temporárias do usuário para 'purchased'
    reservations = reservations.map(res => {
      if (res.status === 'reserved' && res.user_email === user_email) {
        changed = true;
        return {
          ...res,
          status: 'purchased',
          purchased_at: new Date().toISOString(),
          expires_at: undefined // Remove expires_at após a compra
        };
      }
      return res;
    });

    // Se alguma reserva foi alterada, emite a atualização para todos os clientes
    if (changed) {
      console.log(`Reservas de ${user_email} convertidas para compradas.`);
      emitReservationsUpdate();
    } else {
      console.log(`Nenhuma reserva encontrada para compra para ${user_email}.`);
    }
  });

  // Lida com a desconexão do cliente
  socket.on('disconnect', () => {
    console.log(`Cliente desconectado: ${socket.id}`);
  });
});

// Define a porta do servidor
const PORT = process.env.PORT || 3000;

// Inicia o servidor HTTP
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log('Aguardando conexões WebSocket...');
});

// Rota básica para verificar se o servidor está funcionando
app.get('/', (req, res) => {
  res.send('Servidor de Reserva de Números está ativo!');
});
