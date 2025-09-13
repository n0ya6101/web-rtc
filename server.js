const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('join-room', (roomName) => {
        socket.join(roomName);
        console.log(`User ${socket.id} joined room: ${roomName}`);
        
        // Get a list of all other clients in the room
        const clientsInRoom = io.sockets.adapter.rooms.get(roomName);
        const otherUsers = [];
        if (clientsInRoom) {
            clientsInRoom.forEach(clientId => {
                if (clientId !== socket.id) {
                    otherUsers.push(clientId);
                }
            });
        }
        
        // Send the list of existing users to the new user
        socket.emit('existing-users', otherUsers);

        // Notify others that a new user has joined
        socket.to(roomName).emit('user-connected', socket.id);
        
        // --- RELAYING WEBRTC SIGNALS ---
        socket.on('offer', (payload) => {
            io.to(payload.target).emit('offer', payload);
        });

        socket.on('answer', (payload) => {
            io.to(payload.target).emit('answer', payload);
        });

        socket.on('ice-candidate', (payload) => {
            io.to(payload.target).emit('ice-candidate', payload);
        });
        // --- END OF RELAYING ---

        socket.on('disconnect', () => {
            console.log(`User disconnected: ${socket.id}`);
            socket.to(roomName).emit('user-disconnected', socket.id);
        });
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
