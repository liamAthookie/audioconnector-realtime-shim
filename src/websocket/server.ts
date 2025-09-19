import WS, { WebSocket } from 'ws';
import express, { Express, Request } from 'express';
import { Server as HttpServer } from 'http';
import { verifyRequestSignature } from '../auth/authenticator';
import { Session } from '../common/session';
import { getPort } from '../common/environment-variables';
import { SecretService } from '../services/secret-service';

export class Server {
    private httpServer: HttpServer | undefined;
    private wsServer: any;
    private sessionMap: Map<WebSocket, Session> = new Map();
    private secretService = new SecretService();
    
    start(existingHttpServer?: HttpServer) {
        console.log(`Starting server on port: ${getPort()}`);

        if (existingHttpServer) {
            this.httpServer = existingHttpServer;
        } else {
            const app = express();
            this.httpServer = app.listen(getPort());
        }
        
        this.wsServer = new WebSocket.Server({
            noServer: true
        });

        this.httpServer.on('upgrade', (request: Request, socket: any, head: any) => {
            console.log(`Received a connection request from ${request.url}.`);

            // Test endpoint without authentication (DEVELOPMENT ONLY)
            if (request.url?.includes('/test')) {
                console.log('Using test endpoint - skipping authentication');
                this.wsServer.handleUpgrade(request, socket, head, (ws: WebSocket) => {
                    this.wsServer.emit('connection', ws, request);
                });
                return;
            }

            verifyRequestSignature(request, this.secretService)
                .then(verifyResult => {
                    if (verifyResult.code !== 'VERIFIED') {
                        console.log('Authentication failed, closing the connection.');
                        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                        socket.destroy();
                        return;
                    }

                    this.wsServer.handleUpgrade(request, socket, head, (ws: WebSocket) => {
                        console.log('Authentication was successful.');
                        this.wsServer.emit('connection', ws, request);
                    });
                });
        });

        this.wsServer.on('connection', (ws: WebSocket, request: Request) => {
            ws.on('close', () => {
                const session = this.sessionMap.get(ws);
                console.log('WebSocket connection closed.');
                if (session) {
                    session.cleanup();
                }
                this.deleteConnection(ws);
            });

            ws.on('error', (error: Error) => {
                const session = this.sessionMap.get(ws);
                console.log(`WebSocket Error: ${error}`);
                if (session) {
                    session.cleanup();
                }
                ws.close();
            });

            ws.on('message', (data: WS.RawData, isBinary: boolean) => {
                if (ws.readyState !== WebSocket.OPEN) {
                    return;
                }

                const session = this.sessionMap.get(ws);

                if (!session) {
                    const dummySession: Session = new Session(ws, request.headers['audiohook-session-id'] as string, request.url);
                    console.log('Session does not exist.');
                    dummySession.sendDisconnect('error', 'Session does not exist.', {});
                    return;
                }

                if (isBinary) {
                    session.processBinaryMessage(data as Uint8Array);
                } else {
                    session.processTextMessage(data.toString());
                }
            });

            this.createConnection(ws, request);
        });
    }

    private createConnection(ws: WebSocket, request:Request) {
        let session: Session | undefined = this.sessionMap.get(ws);

        if (session) {
            return;
        }

        session = new Session(ws, request.headers['audiohook-session-id'] as string, request.url);
        console.log('Creating a new session.');
        this.sessionMap.set(ws, session);
    }

    private deleteConnection(ws: WebSocket) {
        const session: Session | undefined = this.sessionMap.get(ws);

        if (!session) {
            return;
        }

        try {
            session.close();
            session.cleanup();
        } catch {
        }

        console.log('Deleting session.');
        this.sessionMap.delete(ws);
    }
}