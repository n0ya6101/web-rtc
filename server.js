const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Track rooms and users
const rooms = new Map();

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    let currentRoom = null;

    // Move event listeners outside to avoid nested listeners
    socket.on('join-room', (roomName) => {
        currentRoom = roomName;
        socket.join(roomName);
        console.log(`User ${socket.id} joined room: ${roomName}`);
        
        // Initialize room if it doesn't exist
        if (!rooms.has(roomName)) {
            rooms.set(roomName, new Set());
        }
        
        const roomUsers = rooms.get(roomName);
        const existingUsers = Array.from(roomUsers);
        
        // Add current user to room
        roomUsers.add(socket.id);
        
        // Send existing users to the new user
        socket.emit('existing-users', existingUsers);
        
        // Notify existing users about new user
        socket.to(roomName).emit('user-connected', socket.id);
    });

    socket.on('offer', (payload) => {
        console.log(`Relaying offer from ${payload.sender} to ${payload.target}`);
        io.to(payload.target).emit('offer', payload);
    });

    socket.on('answer', (payload) => {
        console.log(`Relaying answer from ${payload.sender} to ${payload.target}`);
        io.to(payload.target).emit('answer', payload);
    });

    socket.on('ice-candidate', (payload) => {
        console.log(`Relaying ICE candidate from ${payload.sender} to ${payload.target}`);
        io.to(payload.target).emit('ice-candidate', payload);
    });

    socket.on('track-update', (payload) => {
        console.log(`User ${payload.sender} updated tracks`);
        if (currentRoom) {
            socket.to(currentRoom).emit('track-update', payload);
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        
        if (currentRoom) {
            // Remove user from room tracking
            const roomUsers = rooms.get(currentRoom);
            if (roomUsers) {
                roomUsers.delete(socket.id);
                if (roomUsers.size === 0) {
                    rooms.delete(currentRoom);
                    console.log(`Room ${currentRoom} is now empty and removed`);
                }
            }
            
            // Notify other users in the room
            socket.to(currentRoom).emit('user-disconnected', socket.id);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});