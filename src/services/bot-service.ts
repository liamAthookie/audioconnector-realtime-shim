import { EventEmitter } from 'events';
import { JsonStringMap } from '../protocol/core';
import { BotTurnDisposition } from '../protocol/voice-bots';
import { TTSService } from './tts-service';
import { OpenAIRealtimeService, OpenAIRealtimeConfig } from './openai-realtime-service';
import { InstructionLoaderService } from './instruction-loader-service';
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
    private instructionLoader = new InstructionLoaderService();
    private audioCallback: ((audio: Uint8Array) => void) | null = null;
    private isInitialized = false;
    private currentInstructions: string = '';

    constructor(private botId: string, private config: any) {
        super();

        this.currentInstructions = this.instructionLoader.getGreetingInstructions();

        const openAIConfig: OpenAIRealtimeConfig = {
            apiKey: process.env.OPENAI_API_KEY || '',
            voice: 'alloy',
            instructions: this.currentInstructions,
            temperature: 0.7
        };

        this.openAIService = new OpenAIRealtimeService(openAIConfig);
        this.setupOpenAIEventHandlers();

        console.log('[SYSTEM] Initialized with greeting mode');
    }

    private setupOpenAIEventHandlers(): void {
        this.openAIService.on('audio_response', (audioData: Uint8Array) => {
            console.log('[GREETING AGENT] Received audio response from OpenAI, sending to client');
            if (this.audioCallback) {
                this.audioCallback(audioData);
            }
        });

        this.openAIService.on('text_response', (text: string) => {
            console.log('[GREETING AGENT] Text response:', text);
        });

        this.openAIService.on('transcript', (transcript: { text: string; confidence: number }) => {
            console.log('[USER] Transcript:', transcript.text);
        });

        this.openAIService.on('speech_started', () => {
            console.log('[USER] Started speaking');
        });

        this.openAIService.on('speech_stopped', () => {
            console.log('[USER] Stopped speaking');
        });

        this.openAIService.on('response_complete', () => {
            console.log('[GREETING AGENT] Response complete');
        });

        this.openAIService.on('session_timeout', (reason: string) => {
            console.log(`[SYSTEM] Session timeout: ${reason}`);
            this.emit('session_end', reason);
        });

        this.openAIService.on('error', (error: any) => {
            console.error('[SYSTEM] OpenAI Realtime API error:', error);
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
            console.log('[SYSTEM] Bot resource initialized successfully');
        } catch (error) {
            console.error('[SYSTEM] Failed to initialize bot resource:', error);
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

        // Send initial greeting request to OpenAI
        if (this.openAIService.isConnected) {
            // First, add a user message to give the model context
            // According to OpenAI docs, we need something in the conversation for the model to respond to
            const conversationItem = {
                type: 'conversation.item.create',
                item: {
                    type: 'message',
                    role: 'user',
                    content: [
                        {
                            type: 'input_text',
                            text: 'Hello'
                        }
                    ]
                }
            };

            this.openAIService.ws?.send(JSON.stringify(conversationItem));

            // Now create a response - the model will greet based on instructions
            const responseMessage = {
                type: 'response.create',
                response: {
                    modalities: ['text', 'audio']
                }
            };

            this.openAIService.ws?.send(JSON.stringify(responseMessage));
            console.log('[GREETING AGENT] Initial greeting request sent to OpenAI');
        }

        return {
            disposition: 'match',
            text: 'Initializing greeting...',
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