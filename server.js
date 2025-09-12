import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8080 });

console.log('Signaling server started on port 8080');

wss.on('connection', ws => {
  console.log('Client connected.');

  ws.on('message', message => {
    const messageAsString = message.toString();
    console.log('Received message => %s', messageAsString);
    
    // Broadcast the message to all other clients.
    wss.clients.forEach(client => {
      if (client !== ws && client.readyState === ws.OPEN) {
        client.send(messageAsString);
      }
    });
  });

  ws.on('close', () => {
    console.log('Client disconnected.');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});