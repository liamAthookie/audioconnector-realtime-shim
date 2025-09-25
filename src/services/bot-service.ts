import { EventEmitter } from 'events';
import { JsonStringMap } from '../protocol/core';
import { BotTurnDisposition } from '../protocol/voice-bots';
import { TTSService } from './tts-service';
import { OpenAIRealtimeService, OpenAIRealtimeConfig } from './openai-realtime-service';
import * as fs from 'fs';
import * as path from 'path';

export interface BotResponse {
    disposition: BotTurnDisposition;
    text?: string;
    confidence?: number;
    audioBytes?: Uint8Array;
    endSession?: boolean;
}

export class BotResource extends EventEmitter {
    private openAIService: OpenAIRealtimeService;
    private ttsService = new TTSService();
    private audioCallback: ((audio: Uint8Array) => void) | null = null;
    private isInitialized = false;
    private combinedInstructions: string = '';

    constructor(private botId: string, private config: any) {
        super();
        
        // Load and combine instructions
        this.loadInstructions();
        
        const openAIConfig: OpenAIRealtimeConfig = {
            apiKey: process.env.OPENAI_API_KEY || '',
            voice: 'alloy',
            instructions: this.combinedInstructions,
            temperature: 0.7
        };

        this.openAIService = new OpenAIRealtimeService(openAIConfig);
        this.setupOpenAIEventHandlers();
    }

    private loadInstructions(): void {
        try {
            const instructionsDir = path.join(__dirname, '..', '..', 'instructions');
            
            // Load Global Agent Instructions
            const globalInstructionsPath = path.join(instructionsDir, 'Global_Agent_Instructions.md');
            const globalInstructions = fs.readFileSync(globalInstructionsPath, 'utf8');
            
            // Load Greeting Agent Instructions
            const greetingInstructionsPath = path.join(instructionsDir, 'Greeting_Agent_Instructions.md');
            const greetingInstructions = fs.readFileSync(greetingInstructionsPath, 'utf8');
            
            // Combine instructions
            this.combinedInstructions = `${globalInstructions}\n\n${greetingInstructions}`;
            
            console.log('Successfully loaded and combined agent instructions');
        } catch (error) {
            console.error('Error loading instructions:', error);
            // Fallback to default instructions
            this.combinedInstructions = 'You are a helpful customer service assistant. Be concise, friendly, and professional in your responses. Keep responses brief and to the point.';
        }
    }
    private setupOpenAIEventHandlers(): void {
        this.openAIService.on('audio_response', (audioData: Uint8Array) => {
            console.log('Received audio response from OpenAI, sending to client');
            if (this.audioCallback) {
                this.audioCallback(audioData);
            }
        });

        this.openAIService.on('text_response', (text: string) => {
            console.log('Received text response from OpenAI:', text);
            // Text responses are handled via the audio callback mechanism
        });

        this.openAIService.on('transcript', (transcript: { text: string; confidence: number }) => {
            console.log('User transcript:', transcript.text);
        });

        this.openAIService.on('speech_started', () => {
            console.log('User started speaking');
        });

        this.openAIService.on('speech_stopped', () => {
            console.log('User stopped speaking');
        });

        this.openAIService.on('session_timeout', (reason: string) => {
            console.log('Session timeout:', reason);
            this.emit('session_end', reason);
        });

        this.openAIService.on('error', (error: any) => {
            console.error('OpenAI Realtime API error:', error);
            this.emit('session_end', 'error');
        });
    }

    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            await this.openAIService.connect();
            this.isInitialized = true;
            console.log('Bot resource initialized successfully');
        } catch (error) {
            console.error('Failed to initialize bot resource:', error);
            throw error;
        }
    }

    setAudioCallback(callback: (audio: Uint8Array) => void): void {
        this.audioCallback = callback;
    }

    async getInitialResponse(): Promise<BotResponse> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        // Send initial greeting request to OpenAI with combined instructions
        if (this.openAIService.isConnected) {
            // Create a system message with the combined instructions for greeting
            const greetingMessage = {
                type: 'conversation.item.create',
                item: {
                    type: 'message',
                    role: 'system',
                    content: [
                        {
                            type: 'input_text',
                            text: `${this.combinedInstructions}\n\nNow provide the initial greeting as specified in the greeting instructions.`
                        }
                    ]
                }
            };

            this.openAIService.ws?.send(JSON.stringify(greetingMessage));
            
            // Create response to generate the greeting
            const responseMessage = {
                type: 'response.create',
                response: {
                    modalities: ['text', 'audio'],
                    instructions: 'Follow the greeting agent instructions to provide the appropriate welcome message.'
                }
            };

            this.openAIService.ws?.send(JSON.stringify(responseMessage));
        }

        return {
            disposition: 'match',
            text: 'Welcome! Hej och välkommen! I can speak multiple languages. Please describe what you need help with.',
            confidence: 1.0
        };
    }

    async getBotResponse(input: string): Promise<BotResponse> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (!input.trim()) {
            return {
                disposition: 'no_input',
                text: 'I didn\'t hear anything. Could you please repeat that?',
                confidence: 0.5
            };
        }

        try {
            // For text input (like DTMF), send it to OpenAI
            if (this.openAIService.isConnected) {
                this.openAIService.sendText(input);
            }

            // Return a basic response - the actual audio will come through the callback
            return {
                disposition: 'match',
                text: 'Processing your request...',
                confidence: 1.0
            };
        } catch (error) {
            console.error('Error getting bot response:', error);
            
            // Fallback to TTS if OpenAI fails
            const fallbackText = 'I apologize, but I\'m having trouble processing your request right now. Please try again.';
            const audioBytes = await this.ttsService.getAudioBytes(fallbackText);
            
            return {
                disposition: 'no_match',
                text: fallbackText,
                confidence: 0.5,
                audioBytes
            };
        }
    }

    processAudio(audioData: Uint8Array): void {
        if (!this.isInitialized || !this.openAIService.isConnected) {
            console.warn('Bot not initialized or OpenAI not connected');
            return;
        }

        // Send audio directly to OpenAI Realtime API
        this.openAIService.sendAudio(audioData);
    }

    disconnect(): void {
        if (this.openAIService) {
            this.openAIService.disconnect();
        }
        this.isInitialized = false;
    }
}

export class BotService {
    getBotIfExists(url: string | undefined, inputVariables: JsonStringMap): Promise<BotResource | null> {
        console.log(`Looking up Bot Resource for URL: ${url}`);
        console.log(`Input Variables: ${JSON.stringify(inputVariables)}`);

        // For this implementation, we'll always return a bot resource
        // In a real implementation, you would validate the URL and input variables
        // to determine if a valid bot exists
        
        const botResource = new BotResource('default-bot', {
            url,
            inputVariables
        });

        return Promise.resolve(botResource);
    }
}