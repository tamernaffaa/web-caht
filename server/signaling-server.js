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

// Store userId -> socketId mapping
const users = new Map();

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
  users.set(socket.userId, socket.id);

  socket.on('call-user', (data) => {
    socket.join(data.roomId); // Join room for the call
    const targetSocketId = users.get(data.targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('incoming-call', {
        roomId: data.roomId,
        isVideo: data.isVideo,
        caller: data.caller
      });
    }
  });

  socket.on('answer-call', (data) => {
    socket.join(data.roomId); // Target user also joins the room
    const targetSocketId = users.get(data.targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-answered', { roomId: data.roomId });
    }
  });

  socket.on('reject-call', (data) => {
    const targetSocketId = users.get(data.targetUserId);
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
    const targetSocketId = users.get(data.targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('signal', {
        roomId: data.roomId,
        senderId: socket.userId,
        signal: data.signal
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.userId);
    users.delete(socket.userId);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
