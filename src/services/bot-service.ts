import { EventEmitter } from 'events';
import { JsonStringMap } from '../protocol/core';
import { BotTurnDisposition } from '../protocol/voice-bots';
import { TTSService } from './tts-service';
import { OpenAIRealtimeService, OpenAIRealtimeConfig } from './openai-realtime-service';
import { IntentService } from './intent-service';
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
    private intentService = new IntentService();
    private instructionLoader = new InstructionLoaderService();
    private audioCallback: ((audio: Uint8Array) => void) | null = null;
    private isInitialized = false;
    private currentInstructions: string = '';
    private isNewSession = true;
    private currentMode: 'greeting' | 'intent' | 'bot' | 'handover' = 'greeting';

    constructor(private botId: string, private config: any) {
        super();
        
        // Start with greeting instructions for new session
        this.setGreetingMode();
        
        const openAIConfig: OpenAIRealtimeConfig = {
            apiKey: process.env.OPENAI_API_KEY || '',
            voice: 'alloy',
            instructions: this.currentInstructions,
            temperature: 0.7
        };

        this.openAIService = new OpenAIRealtimeService(openAIConfig);
        this.setupOpenAIEventHandlers();
    }

    private setGreetingMode(): void {
        this.currentMode = 'greeting';
        this.currentInstructions = this.instructionLoader.getGreetingInstructions();
        console.log('Set mode to: greeting');
    }

    private setIntentMode(): void {
        this.currentMode = 'intent';
        this.currentInstructions = this.instructionLoader.getIntentInstructions();
        console.log('Set mode to: intent');
    }

    private setBotMode(intentConfig: any): void {
        this.currentMode = 'bot';
        if (intentConfig.botInstructionsFile) {
            this.currentInstructions = this.instructionLoader.loadBotInstructions(intentConfig.botInstructionsFile);
        } else {
            // Fallback to intent instructions if no specific bot instructions
            this.currentInstructions = this.instructionLoader.getIntentInstructions();
        }
        console.log(`Set mode to: bot (${intentConfig.name})`);
    }

    private setHandoverMode(): void {
        this.currentMode = 'handover';
        this.currentInstructions = this.instructionLoader.getHandoverInstructions();
        console.log('Set mode to: handover');
    }

    private updateSessionInstructions(): void {
        if (!this.openAIService.isConnected) return;

        const sessionUpdate = {
            type: 'session.update',
            session: {
                instructions: this.currentInstructions
            }
        };

        this.openAIService.ws?.send(JSON.stringify(sessionUpdate));
        console.log(`Updated session instructions for mode: ${this.currentMode}`);
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

        this.openAIService.on('intent_routed', (routingInfo: any) => {
            console.log('Intent routing received:', routingInfo);
            this.handleIntentRouting(routingInfo);
        });
    }

    private handleIntentRouting(routingInfo: any): void {
        const { intent, confidence } = routingInfo;
        
        console.log(`Processing intent: ${intent} with confidence: ${confidence}`);
        
        // Check if intent is unknown or unclear
        if (intent === 'unclear' || intent === 'support_other' || confidence < 0.7) {
            if (this.isNewSession) {
                console.log('Unknown intent in new session - switching to greeting mode');
                this.setGreetingMode();
            } else {
                console.log('Unknown intent in existing session - switching to intent mode');
                this.setIntentMode();
            }
        } else {
            // Check if we have a bot for this intent
            const intentConfig = this.intentService.getIntentConfig(intent);
            
            if (intentConfig) {
                console.log(`Found bot configuration for intent: ${intent}`);
                this.setBotMode(intentConfig);
            } else {
                console.log(`No bot found for intent: ${intent} - switching to handover mode`);
                this.setHandoverMode();
                
                // Schedule session end after handover response
                setTimeout(() => {
                    console.log('Ending session after handover');
                    this.emit('session_end', 'handover_complete');
                }, 5000); // Give time for handover message to be delivered
            }
        }
        
        // Update session with new instructions
        this.updateSessionInstructions();
        
        // Mark session as no longer new after first intent processing
        this.isNewSession = false;
        
        // Emit to session for further processing
        this.emit('intent_routed', {
            ...routingInfo,
            mode: this.currentMode,
            isHandover: this.currentMode === 'handover'
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

        // Send initial greeting request to OpenAI
        if (this.openAIService.isConnected) {
            // Create a system message for greeting
            const greetingMessage = {
                type: 'conversation.item.create',
                item: {
                    type: 'message',
                    role: 'system',
                    content: [
                        {
                            type: 'input_text',
                            text: 'Provide the initial greeting as specified in the greeting instructions.'
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
                    instructions: this.currentInstructions
                }
            };

            this.openAIService.ws?.send(JSON.stringify(responseMessage));
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

    getCurrentMode(): string {
        return this.currentMode;
    }

    isHandoverMode(): boolean {
        return this.currentMode === 'handover';
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