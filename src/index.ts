import dotenv from 'dotenv';
import express from 'express';
import { Server } from './websocket/server';
import { getPort } from './common/environment-variables';

console.log('Starting service.');

dotenv.config();

// Create a simple health check endpoint for Fly.io
const app = express();
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

const healthServer = app.listen(getPort(), () => {
    console.log(`Health check server running on port ${getPort()}`);
});

// Start the WebSocket server
const wsServer = new Server();
wsServer.start();

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    healthServer.close(() => {
        console.log('Health check server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    healthServer.close(() => {
        console.log('Health check server closed');
        process.exit(0);
    });
});