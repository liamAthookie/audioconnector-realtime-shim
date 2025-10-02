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
    private waitingForHandoverResponse = false;

    constructor(private botId: string, private config: any) {
        super();
        
        const openAIConfig: OpenAIRealtimeConfig = {
            apiKey: process.env.OPENAI_API_KEY || '',
            voice: 'alloy',
            instructions: '', // Will be set after initialization
            temperature: 0.7
        };

        this.openAIService = new OpenAIRealtimeService(openAIConfig);
        this.setupOpenAIEventHandlers();
        
        // Start with greeting instructions for new session (after openAIService is created)
        this.setGreetingMode();
    }

    private setGreetingMode(): void {
        this.currentMode = 'greeting';
        this.currentInstructions = this.instructionLoader.getGreetingInstructions();
        console.log('[SYSTEM] Set mode to: GREETING');
        if (this.openAIService) {
            this.openAIService.setCurrentMode('greeting');
        }
    }

    private setIntentMode(): void {
        this.currentMode = 'intent';
        this.currentInstructions = this.instructionLoader.getIntentInstructions();
        console.log('[SYSTEM] Set mode to: INTENT');
        if (this.openAIService) {
            this.openAIService.setCurrentMode('intent');
        }
    }

    private setBotMode(intentConfig: any): void {
        this.currentMode = 'bot';
        if (intentConfig.botInstructionsFile) {
            this.currentInstructions = this.instructionLoader.loadBotInstructions(intentConfig.botInstructionsFile);
        } else {
            // Fallback to intent instructions if no specific bot instructions
            this.currentInstructions = this.instructionLoader.getIntentInstructions();
        }
        console.log(`[SYSTEM] Set mode to: BOT (${intentConfig.name.toUpperCase()})`);
        if (this.openAIService) {
            this.openAIService.setCurrentMode(`bot-${intentConfig.name}`);
        }
    }

    private setHandoverMode(): void {
        this.currentMode = 'handover';
        this.currentInstructions = this.instructionLoader.getHandoverInstructions();
        console.log('[SYSTEM] Set mode to: HANDOVER');
        if (this.openAIService) {
            this.openAIService.setCurrentMode('handover');
        }
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
        console.log(`[SYSTEM] Updated session instructions for mode: ${this.currentMode.toUpperCase()}`);
    }

    private setupOpenAIEventHandlers(): void {
        this.openAIService.on('audio_response', (audioData: Uint8Array) => {
            console.log(`[${this.currentMode.toUpperCase()} AGENT] Received audio response from OpenAI, sending to client`);
            if (this.audioCallback) {
                this.audioCallback(audioData);
            }
        });

        this.openAIService.on('text_response', (text: string) => {
            console.log(`[${this.currentMode.toUpperCase()} AGENT] Text response: ${text}`);
            // Text responses are handled via the audio callback mechanism
        });

        this.openAIService.on('transcript', (transcript: { text: string; confidence: number }) => {
            console.log(`[USER] Transcript: ${transcript.text}`);
            
            // After first user input in greeting mode, switch to intent mode
            if (this.currentMode === 'greeting' && this.isNewSession) {
                console.log('[SYSTEM] First user input received - switching to intent mode');
                this.setIntentMode();
                this.updateSessionInstructions();
                this.isNewSession = false;
            }
        });

        this.openAIService.on('speech_started', () => {
            console.log('[USER] Started speaking');
            
            // Switch to intent mode as soon as user starts speaking (if still in greeting mode)
            if (this.currentMode === 'greeting' && this.isNewSession) {
                console.log('[SYSTEM] User started speaking - switching to intent mode');
                this.setIntentMode();
                this.updateSessionInstructions();
                this.isNewSession = false;
            }
        });

        this.openAIService.on('speech_stopped', () => {
            console.log('[USER] Stopped speaking');
        });

        this.openAIService.on('response_complete', () => {
            console.log(`[${this.currentMode.toUpperCase()} AGENT] Response complete`);

            // If we're in handover mode and waiting for the handover response, end the session
            if (this.currentMode === 'handover' && this.waitingForHandoverResponse) {
                console.log('[SYSTEM] Handover message delivered - ending session');
                this.waitingForHandoverResponse = false;
                setTimeout(() => {
                    this.emit('session_end', 'handover_complete');
                }, 1000); // Brief delay to ensure audio is fully transmitted
            }
        });

        this.openAIService.on('session_timeout', (reason: string) => {
            console.log(`[SYSTEM] Session timeout: ${reason}`);
            this.emit('session_end', reason);
        });

        this.openAIService.on('error', (error: any) => {
            console.error('[SYSTEM] OpenAI Realtime API error:', error);
            this.emit('session_end', 'error');
        });

        this.openAIService.on('intent_routed', (routingInfo: any) => {
            console.log(`[SYSTEM] Intent routing received: ${JSON.stringify(routingInfo)}`);
            this.handleIntentRouting(routingInfo);
        });
    }

    private handleIntentRouting(routingInfo: any): void {
        const { intent, confidence } = routingInfo;

        console.log(`[SYSTEM] Processing intent: ${intent} with confidence: ${confidence}`);

        // Check if we have a bot for this intent
        const intentConfig = this.intentService.getIntentConfig(intent);

        if (intentConfig) {
            console.log(`[SYSTEM] Found bot configuration for intent: ${intent}`);
            this.setBotMode(intentConfig);
        } else {
            console.log(`[SYSTEM] Intent '${intent}' is not supported - switching to handover mode`);
            this.setHandoverMode();
            this.waitingForHandoverResponse = true;
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
            console.log('[GREETING AGENT] Initial greeting request sent to OpenAI');
        }

        return {
            disposition: 'match',
            text: '[GREETING AGENT] Initializing greeting...',
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