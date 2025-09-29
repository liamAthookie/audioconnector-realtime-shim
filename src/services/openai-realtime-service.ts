import { WebSocket } from 'ws';
import { EventEmitter } from 'events';
import OpenAI from 'openai';
import { FlagsmithService } from './flagsmith-service';
import * as fs from 'fs';
import * as path from 'path';

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
    private config: OpenAIRealtimeConfig;
    private openai: OpenAI;
    private _ws: WebSocket | null = null;
    private _isConnected = false;
    private audioBuffer: Buffer[] = [];
    private currentResponseId: string | null = null;
    private isGeneratingResponse = false;
    private shouldInterruptResponse = false;
    private conversationStartTime: number = 0;
    private maxConversationDuration: number = 300000; // 5 minutes
    private inactivityTimeout: number = 30000; // 30 seconds
    private lastActivityTime: number = 0;
    private timeoutCheckInterval: NodeJS.Timeout | null = null;
    private pendingModerationCheck = false;
    private lastUserSpeechTime: number = 0;
    private responseDebounceTimeout: NodeJS.Timeout | null = null;
    private flagsmithService: FlagsmithService;

    // Tools configuration
    private tools: any[] = [];

    // Public getters for accessing private properties
    get ws(): WebSocket | null {
        return this._ws;
    }
    
    get isConnected(): boolean {
        return this._isConnected;
    }

    constructor(config: OpenAIRealtimeConfig) {
        super();
        this.config = {
            model: 'gpt-4o-realtime-preview-2024-12-17',
            voice: 'alloy',
            temperature: 0.8,
            ...config
        };
        
        this.openai = new OpenAI({
            apiKey: this.config.apiKey
        });
        
        this.flagsmithService = new FlagsmithService();
        
        // Load tools on initialization
        this.loadTools();
    }

    private loadTools(): void {
        try {
            const toolsPath = path.join(__dirname, '..', '..', 'tools', 'tools.json');
            
            if (fs.existsSync(toolsPath)) {
                const toolsData = fs.readFileSync(toolsPath, 'utf8');
                this.tools = JSON.parse(toolsData);
                console.log(`Loaded ${this.tools.length} tools from tools.json`);
                
                // Log tool names for debugging
                this.tools.forEach(tool => {
                    console.log(`- Tool: ${tool.name} (${tool.description})`);
                });
            } else {
                console.log('No tools.json file found, proceeding without tools');
                this.tools = [];
            }
        } catch (error) {
            console.error('Error loading tools:', error);
            this.tools = [];
        }
    }

    async connect(): Promise<void> {
        if (this.isConnected) {
            return;
        }
        
        // Refresh feature flags at the start of each new connection
        console.log('Refreshing feature flags for new connection');
        await this.flagsmithService.refreshFlagsCache();
        
        if (!this.config.apiKey) {
            throw new Error('OpenAI API key is required. Please set the OPENAI_API_KEY environment variable.');
        }

        return new Promise((resolve, reject) => {
            const url = 'wss://api.openai.com/v1/realtime?model=' + this.config.model;
            
            this._ws = new WebSocket(url, {
                headers: {
                    'Authorization': `Bearer ${this.config.apiKey}`,
                    'OpenAI-Beta': 'realtime=v1'
                }
            });

            this._ws.on('open', () => {
                console.log('Connected to OpenAI Realtime API');
                this._isConnected = true;
                this.conversationStartTime = Date.now();
                this.lastActivityTime = Date.now();
                this.startTimeoutCheck();
                this.initializeSession();
                resolve();
            });

            this._ws.on('message', (data: Buffer) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.handleMessage(message);
                } catch (error) {
                    console.error('Error parsing OpenAI message:', error);
                }
            });

            this._ws.on('error', (error) => {
                console.error('OpenAI WebSocket error:', error);
                this._isConnected = false;
                reject(error);
            });

            this._ws.on('close', () => {
                console.log('OpenAI WebSocket connection closed');
                this._isConnected = false;
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
        if (!this._ws) return;

        const sessionConfig: any = {
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
                    threshold: 0.6,
                    prefix_padding_ms: 200,
                    silence_duration_ms: 800
                },
                temperature: this.config.temperature
            }
        };

        // Add tools if available
        if (this.tools.length > 0) {
            sessionConfig.session.tools = this.tools;
            console.log(`Adding ${this.tools.length} tools to session configuration`);
        }

        this._ws.send(JSON.stringify(sessionConfig));
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
                this.lastUserSpeechTime = Date.now();
                
                // If we're currently generating a response, mark it for interruption
                if (this.isGeneratingResponse) {
                    console.log('User interrupted during response generation');
                    this.shouldInterruptResponse = true;
                    this.cancelCurrentResponse();
                }
                
                this.emit('speech_started');
                break;

            case 'input_audio_buffer.speech_stopped':
                console.log('Speech stopped detected by OpenAI');
                this.lastActivityTime = Date.now();
                
                // Clear any existing debounce timeout
                if (this.responseDebounceTimeout) {
                    clearTimeout(this.responseDebounceTimeout);
                }
                
                // Add a small delay before processing to avoid rapid-fire responses
                this.responseDebounceTimeout = setTimeout(() => {
                    if (!this.isGeneratingResponse && !this.shouldInterruptResponse) {
                        // Only commit audio if we're not in the middle of handling an interruption
                        this.commitAudio();
                    }
                    this.shouldInterruptResponse = false;
                }, 300);
                
                this.emit('speech_stopped');
                break;

            case 'conversation.item.input_audio_transcription.completed':
                if (message.transcript) {
                    console.log('Transcription:', message.transcript);
                    this.lastActivityTime = Date.now();
                    
                    // Check if moderation is enabled via feature flag
                    this.flagsmithService.getFeatureValue('moderation-enabled')
                        .then((moderationValue) => {
                            const moderationEnabled = moderationValue === 'true';
                            if (moderationEnabled) {
                                console.log('Moderation enabled, checking content');
                                // Check moderation before emitting transcript
                                return this.checkModeration(message.transcript)
                                    .then((isFlagged) => {
                                        if (isFlagged) {
                                            console.log('Content flagged by moderation, sending rejection response');
                                            // Cancel any active response first
                                            if (this.isGeneratingResponse && this.currentResponseId) {
                                                this.cancelCurrentResponse();
                                            }
                                            // Set flag to prevent normal response processing
                                            this.shouldInterruptResponse = true;
                                            // Send rejection after a brief delay to ensure cancellation is processed
                                            setTimeout(() => {
                                                this.sendModerationRejectionMessage();
                                                this.shouldInterruptResponse = false;
                                            }, 200);
                                        } else {
                                            this.emit('transcript', {
                                                text: message.transcript,
                                                confidence: 1.0
                                            });
                                        }
                                    });
                            } else {
                                console.log('Moderation disabled, skipping moderation check');
                                this.emit('transcript', {
                                    text: message.transcript,
                                    confidence: 1.0
                                });
                                return Promise.resolve();
                            }
                        })
                        .catch((error) => {
                            console.error('Feature flag check or moderation failed:', error);
                            // Continue with normal flow if feature flag check or moderation fails
                            this.emit('transcript', {
                                text: message.transcript,
                                confidence: 1.0
                            });
                        });
                }
                break;

            case 'response.created':
                this.currentResponseId = message.response.id;
                this.isGeneratingResponse = true;
                this.shouldInterruptResponse = false;
                this.audioBuffer = [];
                console.log('Response generation started:', this.currentResponseId);
                break;

            case 'response.audio.delta':
                if (message.delta) {
                    // Check if this response should be interrupted
                    if (this.shouldInterruptResponse) {
                        console.log('Skipping audio delta due to interruption');
                        return;
                    }
                    
                    // OpenAI sends G.711 μ-law directly, no conversion needed
                    const audioData = Buffer.from(message.delta, 'base64');
                    this.audioBuffer.push(audioData);
                }
                break;

            case 'response.audio.done':
                if (this.audioBuffer.length > 0 && !this.shouldInterruptResponse) {
                    const completeAudio = Buffer.concat(this.audioBuffer);
                    this.emit('audio_response', completeAudio);
                } else if (this.shouldInterruptResponse) {
                    console.log('Skipping audio output due to interruption');
                }
                this.audioBuffer = [];
                break;

            case 'response.text.delta':
                if (message.delta) {
                    this.emit('text_delta', message.delta);
                }
                break;

            case 'response.text.done':
                if (message.text && !this.shouldInterruptResponse) {
                    this.emit('text_response', message.text);
                } else if (this.shouldInterruptResponse) {
                    console.log('Skipping text response due to interruption');
                }
                break;

            case 'response.done':
                console.log('Response generation completed:', this.currentResponseId);
                
                if (!this.shouldInterruptResponse) {
                    this.isGeneratingResponse = false;
                    this.emit('response_complete');
                } else {
                    console.log('Response was interrupted, not emitting completion');
                    this.isGeneratingResponse = false;
                }
                
                this.currentResponseId = null;
                this.lastActivityTime = Date.now();
                break;

            case 'response.function_call_arguments.delta':
                if (message.delta) {
                    console.log('Function call arguments delta:', message.delta);
                }
                break;

            case 'response.function_call_arguments.done':
                console.log('Function call arguments completed:', message.arguments);
                this.handleFunctionCall(message.call_id, message.name, message.arguments);
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

    private handleFunctionCall(callId: string, functionName: string, argumentsJson: string): void {
        console.log(`Function call received: ${functionName} with call ID: ${callId}`);
        
        try {
            const args = JSON.parse(argumentsJson);
            console.log('Function arguments:', args);
            
            // Handle the route_intent function call
            if (functionName === 'route_intent') {
                this.handleRouteIntent(callId, args);
            } else {
                console.warn(`Unknown function called: ${functionName}`);
                this.sendFunctionCallResult(callId, { error: 'Unknown function' });
            }
        } catch (error) {
            console.error('Error parsing function arguments:', error);
            this.sendFunctionCallResult(callId, { error: 'Invalid arguments' });
        }
    }

    private handleRouteIntent(callId: string, args: any): void {
        console.log('Processing route_intent with args:', args);
        
        // Validate required fields
        const requiredFields = ['intent', 'confidence', 'entities', 'urgency', 'sentiment', 'summary'];
        const missingFields = requiredFields.filter(field => !(field in args));
        
        if (missingFields.length > 0) {
            console.error('Missing required fields:', missingFields);
            this.sendFunctionCallResult(callId, { 
                error: `Missing required fields: ${missingFields.join(', ')}` 
            });
            return;
        }
        
        // Emit the routing information for the session to handle
        this.emit('intent_routed', {
            intent: args.intent,
            confidence: args.confidence,
            entities: args.entities,
            urgency: args.urgency,
            sentiment: args.sentiment,
            summary: args.summary
        });
        
        // Send success response back to OpenAI
        this.sendFunctionCallResult(callId, {
            success: true,
            message: `Intent '${args.intent}' routed successfully with confidence ${args.confidence}`
        });
    }

    private sendFunctionCallResult(callId: string, result: any): void {
        if (!this._ws || !this._isConnected) return;

        const message = {
            type: 'conversation.item.create',
            item: {
                type: 'function_call_output',
                call_id: callId,
                output: JSON.stringify(result)
            }
        };

        this._ws.send(JSON.stringify(message));
        
        // Create a response to continue the conversation
        const responseMessage = {
            type: 'response.create',
            response: {
                modalities: ['text', 'audio']
            }
        };

        this._ws.send(JSON.stringify(responseMessage));
    }

    private async checkModeration(text: string): Promise<boolean> {
        try {
            console.log('Checking moderation for text:', text);
            const moderationResponse = await this.openai.moderations.create({
                input: text,
                model: 'omni-moderation-latest'
            });

            const result = moderationResponse.results[0];
            const isFlagged = result.flagged;
            
            if (isFlagged) {
                console.log('Content flagged by moderation:', result.categories);
            }
            
            return isFlagged;
        } catch (error) {
            console.error('Error calling moderation API:', error);
            // Return false to allow content through if moderation fails
            return false;
        }
    }


    private sendModerationRejectionMessage(): void {
        if (!this.ws || !this.isConnected) return;

        console.log('Sending moderation rejection message');
        
        // Create a conversation item with the rejection message
        const rejectionMessage = {
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'assistant',
                content: [
                    {
                        type: 'text',
                        text: "I'm sorry, I cannot help you with that request."
                    }
                ]
            }
        };

        this.ws.send(JSON.stringify(rejectionMessage));
        
        // Create a response to generate audio for the rejection
        const responseMessage = {
            type: 'response.create',
            response: {
                modalities: ['text', 'audio'],
                instructions: 'Please respond with the exact text provided without modification.'
            }
        };

        this.ws.send(JSON.stringify(responseMessage));
    }

    private cancelCurrentResponse(): void {
        if (!this._ws || !this._isConnected || !this.currentResponseId) return;

        console.log('Cancelling current response:', this.currentResponseId);
        
        const cancelMessage = {
            type: 'response.cancel'
        };

        this._ws.send(JSON.stringify(cancelMessage));
        
        // Clear audio buffer to prevent stale audio from playing
        this.audioBuffer = [];
    }

    sendAudio(audioData: Uint8Array): void {
        if (!this._ws || !this._isConnected) {
            console.warn('OpenAI WebSocket not connected');
            return;
        }

        // Don't send audio if we're in the middle of generating a response
        // unless enough time has passed since the last user speech
        const timeSinceLastSpeech = Date.now() - this.lastUserSpeechTime;
        if (this.isGeneratingResponse && timeSinceLastSpeech < 1000) {
            // Allow recent speech to interrupt
            this.shouldInterruptResponse = true;
        }

        // Send PCMU data directly as G.711 μ-law
        const base64Audio = Buffer.from(audioData).toString('base64');

        const message = {
            type: 'input_audio_buffer.append',
            audio: base64Audio
        };

        this._ws.send(JSON.stringify(message));
    }

    sendText(text: string): void {
        if (!this._ws || !this._isConnected) {
            console.warn('OpenAI WebSocket not connected');
            return;
        }

        // Don't send text if we're currently generating a response
        if (this.isGeneratingResponse) {
            console.log('Skipping text input - response in progress');
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

        this._ws.send(JSON.stringify(message));
        this.createResponse();
    }

    private createResponse(): void {
        if (!this._ws || !this._isConnected) return;

        // Don't create a new response if one is already in progress
        if (this.isGeneratingResponse) {
            console.log('Response already in progress, skipping new response creation');
            return;
        }

        const message = {
            type: 'response.create',
            response: {
                modalities: ['text', 'audio'],
                instructions: 'Please respond naturally and helpfully.'
            }
        };

        this._ws.send(JSON.stringify(message));
    }

    commitAudio(): void {
        if (!this._ws || !this._isConnected) return;

        // Don't commit audio if we're generating a response or should interrupt
        if (this.isGeneratingResponse || this.shouldInterruptResponse) {
            console.log('Skipping audio commit - response in progress or interrupted');
            return;
        }

        const message = {
            type: 'input_audio_buffer.commit'
        };

        this._ws.send(JSON.stringify(message));
    }

    clearAudioBuffer(): void {
        if (!this._ws || !this._isConnected) return;

        const message = {
            type: 'input_audio_buffer.clear'
        };

        this._ws.send(JSON.stringify(message));
    }

    disconnect(): void {
        if (this.responseDebounceTimeout) {
            clearTimeout(this.responseDebounceTimeout);
            this.responseDebounceTimeout = null;
        }
        if (this.timeoutCheckInterval) {
            clearInterval(this.timeoutCheckInterval);
            this.timeoutCheckInterval = null;
        }
        if (this._ws) {
            this._ws.close();
            this._ws = null;
        }
        this._isConnected = false;
        this.isGeneratingResponse = false;
        this.shouldInterruptResponse = false;
    }
}