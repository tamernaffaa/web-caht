const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config({ path: '../.env' }); // Try to load .env from parent if exists

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Store userId -> Set<socketId> mapping to handle reconnects/multiple tabs safely.
const users = new Map();

const getTargetSocketId = (userId) => {
  const socketIds = users.get(userId);
  if (!socketIds || socketIds.size === 0) return null;
  // Pick the most recently inserted socket id.
  return Array.from(socketIds).at(-1);
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
    const targetSocketId = getTargetSocketId(data.targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('incoming-call', {
        roomId: data.roomId,
        isVideo: data.isVideo,
        caller: data.caller
      });
    } else {
      console.log('Target user is offline for incoming-call:', data.targetUserId);
    }
  });

  socket.on('answer-call', (data) => {
    socket.join(data.roomId); // Target user also joins the room
    const targetSocketId = getTargetSocketId(data.targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-answered', { roomId: data.roomId });
    }
  });

  socket.on('reject-call', (data) => {
    const targetSocketId = getTargetSocketId(data.targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-rejected', { roomId: data.roomId });
    }
  });

  socket.on('end-call', (data) => {
    // Notify others in the room
    socket.to(data.roomId).emit('call-ended', { roomId: data.roomId });
    // Leave the room
    socket.leave(data.roomId);
  });

  socket.on('signal', (data) => {
    const targetSocketId = getTargetSocketId(data.targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('signal', {
        roomId: data.roomId,
        senderId: socket.userId,
        signal: data.signal
      });
    } else {
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

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
