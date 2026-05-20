const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();
require('dotenv').config({ path: '../.env' });

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const allowedOrigins = (process.env.FRONTEND_ORIGIN || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOriginHandler = (origin, callback) => {
  // Allow server-to-server checks (no Origin header) and permissive mode.
  if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
    callback(null, true);
    return;
  }
  callback(new Error('Not allowed by CORS'));
};

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: corsOriginHandler, credentials: true }));
app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: corsOriginHandler,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Store userId -> Set<socketId> mapping to handle reconnects/multiple tabs safely.
const users = new Map();

const emitToUserSockets = (userId, event, payload) => {
  const socketIds = users.get(userId);
  if (!socketIds || socketIds.size === 0) return false;

  for (const socketId of socketIds) {
    io.to(socketId).emit(event, payload);
  }
  return true;
};

io.use((socket, next) => {
  const userId = socket.handshake.auth.userId;
  if (!userId) {
    return next(new Error("invalid user"));
  }
  socket.userId = userId;
  next();
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.userId, 'Socket ID:', socket.id);
  const existingSocketIds = users.get(socket.userId) || new Set();
  existingSocketIds.add(socket.id);
  users.set(socket.userId, existingSocketIds);

  socket.on('call-user', (data) => {
    socket.join(data.roomId); // Join room for the call
    const delivered = emitToUserSockets(data.targetUserId, 'incoming-call', {
        roomId: data.roomId,
        isVideo: data.isVideo,
        caller: data.caller
      });
    if (!delivered) {
      console.log('Target user is offline for incoming-call:', data.targetUserId);
    }
  });

  socket.on('answer-call', (data) => {
    socket.join(data.roomId); // Target user also joins the room
    emitToUserSockets(data.targetUserId, 'call-answered', { roomId: data.roomId });
  });

  socket.on('reject-call', (data) => {
    emitToUserSockets(data.targetUserId, 'call-rejected', { roomId: data.roomId });
  });

  socket.on('end-call', (data) => {
    // Notify others in the room
    socket.to(data.roomId).emit('call-ended', { roomId: data.roomId });
    // Leave the room
    socket.leave(data.roomId);
  });

  socket.on('signal', (data) => {
    const delivered = emitToUserSockets(data.targetUserId, 'signal', {
        roomId: data.roomId,
        senderId: socket.userId,
        signal: data.signal
      });

    // Fallback: route by room in case target socket mapping is stale.
    if (!delivered && data.roomId) {
      socket.to(data.roomId).emit('signal', {
        roomId: data.roomId,
        senderId: socket.userId,
        signal: data.signal
      });
    }

    if (!delivered) {
      console.log('Signal target unavailable:', data.targetUserId, 'room:', data.roomId);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.userId);
    const socketIds = users.get(socket.userId);
    if (!socketIds) return;

    socketIds.delete(socket.id);
    if (socketIds.size === 0) {
      users.delete(socket.userId);
    } else {
      users.set(socket.userId, socketIds);
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Signaling server running on ${HOST}:${PORT}`);
  console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
});
