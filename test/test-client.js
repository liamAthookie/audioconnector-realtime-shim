const WebSocket = require('ws');
const crypto = require('crypto');

class AudioConnectorTestClient {
    constructor(serverUrl, apiKey, secret) {
        this.serverUrl = serverUrl;
        this.apiKey = apiKey;
        this.secret = secret;
        this.ws = null;
        this.clientSeq = 0;
        this.serverSeq = 0;
        this.sessionId = crypto.randomUUID();
    }

    // Create HTTP signature for authentication
    createSignature(url, headers) {
        const nonce = crypto.randomBytes(16).toString('base64');
        const created = Math.floor(Date.now() / 1000);
        
        // Simplified signature creation for testing
        const signatureBase = `@request-target: ${url}\n@authority: ${headers.host}\naudiohook-organization-id: ${headers['audiohook-organization-id']}\naudiohook-session-id: ${headers['audiohook-session-id']}\naudiohook-correlation-id: ${headers['audiohook-correlation-id']}\nx-api-key: ${headers['x-api-key']}`;
        
        const signature = crypto.createHmac('sha256', Buffer.from(this.secret))
            .update(signatureBase)
            .digest('base64');

        return {
            signature: `keyid="${this.apiKey}",algorithm="hmac-sha256",created=${created},nonce="${nonce}",signature="${signature}"`,
            'signature-input': `sig1=("@request-target" "@authority" "audiohook-organization-id" "audiohook-session-id" "audiohook-correlation-id" "x-api-key");keyid="${this.apiKey}";alg="hmac-sha256";created=${created};nonce="${nonce}"`
        };
    }

    connect() {
        return new Promise((resolve, reject) => {
            const headers = {
                'host': new URL(this.serverUrl).host,
                'audiohook-organization-id': crypto.randomUUID(),
                'audiohook-session-id': this.sessionId,
                'audiohook-correlation-id': crypto.randomUUID(),
                'x-api-key': this.apiKey
            };

            const signatureHeaders = this.createSignature(new URL(this.serverUrl).pathname, headers);
            Object.assign(headers, signatureHeaders);

            this.ws = new WebSocket(this.serverUrl, { headers });

            this.ws.on('open', () => {
                console.log('✅ Connected to AudioConnector server');
                resolve();
            });

            this.ws.on('message', (data, isBinary) => {
                if (isBinary) {
                    console.log('📡 Received binary data:', data.length, 'bytes');
                } else {
                    const message = JSON.parse(data.toString());
                    console.log('📨 Received message:', message.type);
                    this.serverSeq = message.seq;
                }
            });

            this.ws.on('error', (error) => {
                console.error('❌ WebSocket error:', error.message);
                reject(error);
            });

            this.ws.on('close', () => {
                console.log('🔌 Connection closed');
            });
        });
    }

    sendMessage(type, parameters) {
        const message = {
            version: '2',
            id: this.sessionId,
            type,
            seq: ++this.clientSeq,
            serverseq: this.serverSeq,
            position: 'PT0S',
            parameters
        };

        console.log('📤 Sending message:', type);
        this.ws.send(JSON.stringify(message));
    }

    // Send open message to start session
    sendOpen() {
        this.sendMessage('open', {
            organizationId: crypto.randomUUID(),
            conversationId: crypto.randomUUID(),
            participant: {
                id: crypto.randomUUID(),
                ani: '+1234567890',
                aniName: 'Test User',
                dnis: '+0987654321'
            },
            media: [{
                type: 'audio',
                format: 'PCMU',
                channels: ['external'],
                rate: 8000
            }],
            language: 'en-US',
            inputVariables: {
                testMode: 'true'
            }
        });
    }

    // Send test audio data
    sendTestAudio() {
        // Generate 1 second of silence (8000 bytes for 8kHz PCMU)
        const audioData = new Uint8Array(8000).fill(0xFF); // PCMU silence
        console.log('🎵 Sending test audio data');
        this.ws.send(audioData);
    }

    // Send DTMF digit
    sendDTMF(digit) {
        this.sendMessage('dtmf', { digit });
    }

    // Send ping
    sendPing() {
        this.sendMessage('ping', { rtt: 'PT0.1S' });
    }

    // Close connection
    close() {
        this.sendMessage('close', { reason: 'end' });
        setTimeout(() => this.ws.close(), 1000);
    }
}

// Test script
async function runTest() {
    const serverUrl = process.env.TEST_SERVER_URL || 'ws://localhost:8080';
    const apiKey = process.env.TEST_API_KEY || 'ApiKey1';
    const secret = process.env.TEST_SECRET || 'Secret1';

    console.log('🚀 Starting AudioConnector test client');
    console.log('📍 Server URL:', serverUrl);

    const client = new AudioConnectorTestClient(serverUrl, apiKey, secret);

    try {
        await client.connect();
        
        // Wait a moment then send open message
        setTimeout(() => client.sendOpen(), 500);
        
        // Send test audio after opening
        setTimeout(() => client.sendTestAudio(), 2000);
        
        // Send DTMF
        setTimeout(() => client.sendDTMF('1'), 4000);
        
        // Send ping
        setTimeout(() => client.sendPing(), 6000);
        
        // Close connection
        setTimeout(() => client.close(), 8000);
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    runTest();
}

module.exports = AudioConnectorTestClient;