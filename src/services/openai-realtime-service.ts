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

    private initializeSession(): void {
        if (!this.ws) return;

        const sessionUpdate = {
            type: 'session.update',
            session: {
                modalities: ['text', 'audio'],
                instructions: this.config.instructions || 'You are a helpful voice assistant. Be concise and natural in your responses.',
                voice: this.config.voice,
                input_audio_format: 'pcm16',
                output_audio_format: 'pcm16',
                input_audio_transcription: {
                    model: 'whisper-1'
                },
                turn_detection: {
                    type: 'server_vad',
                    threshold: 0.6,
                    prefix_padding_ms: 500,
                    silence_duration_ms: 800
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
                this.emit('speech_started');
                break;

            case 'input_audio_buffer.speech_stopped':
                console.log('Speech stopped detected by OpenAI');
                this.emit('speech_stopped');
                break;

            case 'conversation.item.input_audio_transcription.completed':
                if (message.transcript) {
                    console.log('Transcription:', message.transcript);
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

        // Convert PCMU to PCM16 if needed
        const pcm16Data = this.convertPCMUtoPCM16(audioData);
        const base64Audio = Buffer.from(pcm16Data).toString('base64');

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

    // Expose conversion method for use in bot-service
    convertPCM16ToPCMU(pcm16Data: Int16Array): Uint8Array {
        return this.convertPCM16ToPCMU(pcm16Data);
    }

    private convertPCMUtoPCM16(pcmuData: Uint8Array): Int16Array {
        // PCMU (μ-law) to PCM16 conversion with lookup table for better accuracy
        const pcm16Data = new Int16Array(pcmuData.length);
        
        // μ-law decode lookup table for better performance and accuracy
        const mulawToPcm = new Int16Array(256);
        for (let i = 0; i < 256; i++) {
            const mulaw = i;
            let sign = (mulaw & 0x80) ? -1 : 1;
            let exponent = (mulaw & 0x70) >> 4;
            let mantissa = mulaw & 0x0F;
            
            let sample = mantissa << (exponent + 3);
            if (exponent > 0) {
                sample += (1 << (exponent + 2));
            }
            sample = (sample - 132) * sign;
            
            mulawToPcm[i] = Math.max(-32768, Math.min(32767, sample));
        }
        
        for (let i = 0; i < pcmuData.length; i++) {
            pcm16Data[i] = mulawToPcm[pcmuData[i]];
        }
        
        return pcm16Data;
    }

    private convertPCM16ToPCMU(pcm16Data: Int16Array): Uint8Array {
        // PCM16 to PCMU (μ-law) conversion with improved quantization
        const pcmuData = new Uint8Array(pcm16Data.length);
        
        // Bias value for μ-law encoding
        const BIAS = 0x84;
        const CLIP = 32635;
        
        for (let i = 0; i < pcm16Data.length; i++) {
            let sample = pcm16Data[i];
            
            // Get sign and make sample positive
            const sign = (sample >> 8) & 0x80;
            if (sign) sample = -sample;
            
            // Clip the magnitude
            if (sample > CLIP) sample = CLIP;
            
            // Add bias
            sample += BIAS;
            
            // Find exponent
            let exponent = 0;
            if (sample >= 256) {
                exponent = 1;
                while (sample >= (512 << exponent) && exponent < 7) {
                    exponent++;
                }
            }
            
            // Find mantissa
            const mantissa = (sample >> (exponent + 3)) & 0x0F;
            
            // Combine sign, exponent, and mantissa
            pcmuData[i] = ~(sign | (exponent << 4) | mantissa);
        }
        
        return pcmuData;
    }

    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
    }
}