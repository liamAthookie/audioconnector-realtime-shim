import { WebSocket } from 'ws';
import { EventEmitter } from 'events';

export interface OpenAIRealtimeConfig {
    apiKey: string;
    model?: string;
    voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
    instructions?: string;
    temperature?: number;
}

export interface OpenAIRealtimeResponse {
    text?: string;
    audioBytes?: Uint8Array;
    endSession?: boolean;
    confidence?: number;
}

export class OpenAIRealtimeService extends EventEmitter {
    private ws: WebSocket | null = null;
    private config: OpenAIRealtimeConfig;
    private isConnected = false;
    private audioBuffer: Buffer[] = [];
    private currentResponseId: string | null = null;
    private conversationStartTime: number = 0;
    private maxConversationDuration: number = 300000; // 5 minutes
    private inactivityTimeout: number = 30000; // 30 seconds
    private lastActivityTime: number = 0;
    private timeoutCheckInterval: NodeJS.Timeout | null = null;

    constructor(config: OpenAIRealtimeConfig) {
        super();
        this.config = {
            model: 'gpt-4o-realtime-preview-2024-12-17',
            voice: 'alloy',
            temperature: 0.8,
            ...config
        };
    }

    async connect(): Promise<void> {
        if (this.isConnected) {
            return;
        }
        
        if (!this.config.apiKey) {
            throw new Error('OpenAI API key is required. Please set the OPENAI_API_KEY environment variable.');
        }

        return new Promise((resolve, reject) => {
            const url = 'wss://api.openai.com/v1/realtime?model=' + this.config.model;
            
            this.ws = new WebSocket(url, {
                headers: {
                    'Authorization': `Bearer ${this.config.apiKey}`,
                    'OpenAI-Beta': 'realtime=v1'
                }
            });

            this.ws.on('open', () => {
                console.log('Connected to OpenAI Realtime API');
                this.isConnected = true;
                this.conversationStartTime = Date.now();
                this.lastActivityTime = Date.now();
                this.startTimeoutCheck();
                this.initializeSession();
                resolve();
            });

            this.ws.on('message', (data: Buffer) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.handleMessage(message);
                } catch (error) {
                    console.error('Error parsing OpenAI message:', error);
                }
            });

            this.ws.on('error', (error) => {
                console.error('OpenAI WebSocket error:', error);
                this.isConnected = false;
                reject(error);
            });

            this.ws.on('close', () => {
                console.log('OpenAI WebSocket connection closed');
                this.isConnected = false;
            });
        });
    }

    private startTimeoutCheck(): void {
        this.timeoutCheckInterval = setInterval(() => {
            const now = Date.now();
            const conversationDuration = now - this.conversationStartTime;
            const timeSinceLastActivity = now - this.lastActivityTime;

            // Check for maximum conversation duration
            if (conversationDuration > this.maxConversationDuration) {
                console.log('Maximum conversation duration reached, ending session');
                this.emit('session_timeout', 'max_duration');
                return;
            }

            // Check for inactivity timeout
            if (timeSinceLastActivity > this.inactivityTimeout) {
                console.log('Inactivity timeout reached, ending session');
                this.emit('session_timeout', 'inactivity');
                return;
            }
        }, 5000); // Check every 5 seconds
    }

    private initializeSession(): void {
        if (!this.ws) return;

        const sessionUpdate = {
            type: 'session.update',
            session: {
                modalities: ['text', 'audio'],
                instructions: this.config.instructions || 'You are a helpful voice assistant. Be concise and natural in your responses.',
                voice: this.config.voice,
                input_audio_format: 'g711_ulaw',
                output_audio_format: 'g711_ulaw',
                input_audio_transcription: {
                    model: 'whisper-1'
                },
                turn_detection: {
                    type: 'server_vad',
                    threshold: 0.5,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 500
                },
                temperature: this.config.temperature
            }
        };

        this.ws.send(JSON.stringify(sessionUpdate));
    }

    private handleMessage(message: any): void {
        switch (message.type) {
            case 'session.created':
                console.log('OpenAI session created');
                break;

            case 'session.updated':
                console.log('OpenAI session updated');
                break;

            case 'input_audio_buffer.speech_started':
                console.log('Speech started detected by OpenAI');
                this.lastActivityTime = Date.now();
                this.emit('speech_started');
                break;

            case 'input_audio_buffer.speech_stopped':
                console.log('Speech stopped detected by OpenAI');
                this.lastActivityTime = Date.now();
                this.emit('speech_stopped');
                break;

            case 'conversation.item.input_audio_transcription.completed':
                if (message.transcript) {
                    console.log('Transcription:', message.transcript);
                    this.lastActivityTime = Date.now();
                    this.emit('transcript', {
                        text: message.transcript,
                        confidence: 1.0
                    });
                }
                break;

            case 'response.created':
                this.currentResponseId = message.response.id;
                this.audioBuffer = [];
                break;

            case 'response.audio.delta':
                if (message.delta) {
                    // OpenAI sends G.711 μ-law directly, no conversion needed
                    const audioData = Buffer.from(message.delta, 'base64');
                    this.audioBuffer.push(audioData);
                }
                break;

            case 'response.audio.done':
                if (this.audioBuffer.length > 0) {
                    const completeAudio = Buffer.concat(this.audioBuffer);
                    this.emit('audio_response', completeAudio);
                    this.audioBuffer = [];
                }
                break;

            case 'response.text.delta':
                if (message.delta) {
                    this.emit('text_delta', message.delta);
                }
                break;

            case 'response.text.done':
                if (message.text) {
                    this.emit('text_response', message.text);
                }
                break;

            case 'response.done':
                this.emit('response_complete');
                this.currentResponseId = null;
                this.lastActivityTime = Date.now();
                break;

            case 'error':
                console.error('OpenAI API error:', message.error);
                this.emit('error', message.error);
                break;

            default:
                // console.log('Unhandled OpenAI message type:', message.type);
                break;
        }
    }

    sendAudio(audioData: Uint8Array): void {
        if (!this.ws || !this.isConnected) {
            console.warn('OpenAI WebSocket not connected');
            return;
        }

        // Send PCMU data directly as G.711 μ-law
        const base64Audio = Buffer.from(audioData).toString('base64');

        const message = {
            type: 'input_audio_buffer.append',
            audio: base64Audio
        };

        this.ws.send(JSON.stringify(message));
    }

    sendText(text: string): void {
        if (!this.ws || !this.isConnected) {
            console.warn('OpenAI WebSocket not connected');
            return;
        }

        const message = {
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [
                    {
                        type: 'input_text',
                        text: text
                    }
                ]
            }
        };

        this.ws.send(JSON.stringify(message));
        this.createResponse();
    }

    private createResponse(): void {
        if (!this.ws || !this.isConnected) return;

        const message = {
            type: 'response.create',
            response: {
                modalities: ['text', 'audio'],
                instructions: 'Please respond naturally and helpfully.'
            }
        };

        this.ws.send(JSON.stringify(message));
    }

    commitAudio(): void {
        if (!this.ws || !this.isConnected) return;

        const message = {
            type: 'input_audio_buffer.commit'
        };

        this.ws.send(JSON.stringify(message));
    }

    clearAudioBuffer(): void {
        if (!this.ws || !this.isConnected) return;

        const message = {
            type: 'input_audio_buffer.clear'
        };

        this.ws.send(JSON.stringify(message));
    }

    disconnect(): void {
        if (this.timeoutCheckInterval) {
            clearInterval(this.timeoutCheckInterval);
            this.timeoutCheckInterval = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
    }
}