import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import { Server } from './websocket/server';
import { getPort } from './common/environment-variables';

console.log('Starting service.');

dotenv.config();

// Create a simple health check endpoint for Fly.io
const app = express();
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Create HTTP server
const httpServer = createServer(app);

httpServer.listen(getPort(), () => {
    console.log(`Server running on port ${getPort()}`);
});

// Start the WebSocket server using the same HTTP server
const wsServer = new Server();
wsServer.start(httpServer);

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    httpServer.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    httpServer.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});