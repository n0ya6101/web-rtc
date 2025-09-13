const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
// NEW: Import the cors library
const cors = require('cors');

const app = express();
// NEW: Use the cors middleware with your Express app
app.use(cors());

const server = http.createServer(app);

// NEW: Add a cors configuration object to the Socket.IO server
const io = new Server(server, {
    cors: {
        origin: "*", // Allow connections from any origin
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('join-room', (roomName) => {
        socket.join(roomName);
        console.log(`User ${socket.id} joined room: ${roomName}`);
        
        const clientsInRoom = io.sockets.adapter.rooms.get(roomName);
        const otherUsers = [];
        if (clientsInRoom) {
            clientsInRoom.forEach(clientId => {
                if (clientId !== socket.id) {
                    otherUsers.push(clientId);
                }
            });
        }
        
        socket.emit('existing-users', otherUsers);

        socket.to(roomName).emit('user-connected', socket.id);
        
        socket.on('offer', (payload) => {
            io.to(payload.target).emit('offer', payload);
        });

        socket.on('answer', (payload) => {
            io.to(payload.target).emit('answer', payload);
        });

        socket.on('ice-candidate', (payload) => {
            io.to(payload.target).emit('ice-candidate', payload);
        });

        socket.on('disconnect', () => {
            console.log(`User disconnected: ${socket.id}`);
            socket.to(roomName).emit('user-disconnected', socket.id);
        });
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

