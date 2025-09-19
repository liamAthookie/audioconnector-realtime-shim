import { JsonStringMap } from "../protocol/core";
import { BotTurnDisposition } from "../protocol/voice-bots";
import { OpenAIRealtimeService, OpenAIRealtimeConfig } from "./openai-realtime-service";

/*
* This class provides support for retreiving a Bot Resource based on the supplied
* connection URL and input variables.
* 
* For the purposes of this example, we are just returning a "dummy" resource, and
* a real implemetation will need to be provided.
*/
export class BotService {
    private openAIConfig: OpenAIRealtimeConfig;

    constructor() {
        this.openAIConfig = {
            apiKey: process.env.OPENAI_API_KEY || '',
            model: 'gpt-4o-realtime-preview-2024-12-17',
            voice: 'alloy',
            instructions: 'You are a helpful voice assistant for customer service. Be concise, friendly, and professional.',
            temperature: 0.8
        };
        
        if (!this.openAIConfig.apiKey) {
            console.error('OPENAI_API_KEY environment variable is not set');
        }
    }

    getBotIfExists(connectionUrl: string, inputVariables: JsonStringMap): Promise<BotResource | null> {
        if (!this.openAIConfig.apiKey) {
            console.error('OpenAI API key not configured. Please set the OPENAI_API_KEY environment variable.');
            return Promise.resolve(null);
        }
        return Promise.resolve(new BotResource(this.openAIConfig));
    }
}

/*
* This class provides support for the various methods needed to interact with an Bot.
*/
export class BotResource {
    private openAIService: OpenAIRealtimeService;
    private isInitialized = false;
    private pendingAudioData: Uint8Array[] = [];
    private currentResponse: BotResponse | null = null;
    private responsePromise: Promise<BotResponse> | null = null;
    private responseResolve: ((response: BotResponse) => void) | null = null;

    constructor(config: OpenAIRealtimeConfig) {
        this.openAIService = new OpenAIRealtimeService(config);
        this.setupEventHandlers();
    }

    private setupEventHandlers(): void {
        this.openAIService.on('transcript', (transcript) => {
            console.log('OpenAI transcript:', transcript.text);
        });

        this.openAIService.on('text_response', (text) => {
            console.log('OpenAI text response:', text);
            if (this.currentResponse) {
                this.currentResponse.text = text;
            }
        });

        this.openAIService.on('audio_response', (audioBuffer: Buffer) => {
            console.log('OpenAI audio response received:', audioBuffer.length, 'bytes');
            if (this.currentResponse) {
                // Convert PCM16 back to PCMU for the AudioConnector client
                const pcm16Data = new Int16Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.length / 2);
                const pcmuData = this.openAIService.convertPCM16ToPCMU(pcm16Data);
                this.currentResponse.audioBytes = pcmuData;
            }
        });

        this.openAIService.on('response_complete', () => {
            console.log('OpenAI response complete');
            if (this.responseResolve && this.currentResponse) {
                this.responseResolve(this.currentResponse);
                this.responseResolve = null;
                this.currentResponse = null;
            }
        });

        this.openAIService.on('error', (error) => {
            console.error('OpenAI service error:', error);
            if (this.responseResolve) {
                const errorResponse = new BotResponse('no_match', 'I apologize, but I encountered an error. Please try again.')
                    .withConfidence(0.5);
                this.responseResolve(errorResponse);
                this.responseResolve = null;
                this.currentResponse = null;
            }
        });
    }

    private async ensureInitialized(): Promise<void> {
        if (!this.isInitialized) {
            await this.openAIService.connect();
            this.isInitialized = true;
        }
    }

    /*
    * This method is used to retrieve the initial response from the Bot.
    * 
    * This is a "dummy" implementation that will need to be replaced.
    */
    getInitialResponse(): Promise<BotResponse> {
        return this.ensureInitialized().then(() => {
            // Send initial greeting message to OpenAI
            const initialMessage = "Please greet the user and ask how you can help them today.";
            return this.getBotResponse(initialMessage);
        });
    }

    /*
    * This method is used to retrieve the a response from the Bot
    * based on the provided input. For this implementation, the
    * input is either the Caller's audio's transcript, or captured
    * DTMF digits.
    * 
    * This is a "dummy" implementation that will need to be replaced.
    */
    getBotResponse(data: string): Promise<BotResponse> {
        return this.ensureInitialized().then(() => {
            return new Promise<BotResponse>((resolve) => {
                this.currentResponse = new BotResponse('match', '').withConfidence(0.9);
                this.responseResolve = resolve;
                
                // Send the user input to OpenAI
                this.openAIService.sendText(data);
            });
        });
    }

    /*
    * Process audio data from the user
    */
    processAudio(audioData: Uint8Array): void {
        if (!this.isInitialized) {
            this.pendingAudioData.push(audioData);
            return;
        }

        // Process any pending audio data first
        if (this.pendingAudioData.length > 0) {
            this.pendingAudioData.forEach(data => {
                this.openAIService.sendAudio(data);
            });
            this.pendingAudioData = [];
        }

        this.openAIService.sendAudio(audioData);
    }

    /*
    * Commit the audio buffer to trigger OpenAI processing
    */
    commitAudio(): void {
        if (this.isInitialized) {
            this.openAIService.commitAudio();
        }
    }

    /*
    * Clear the audio buffer
    */
    clearAudio(): void {
        if (this.isInitialized) {
            this.openAIService.clearAudioBuffer();
        }
    }

            
            // Ensure quantized value is in range [0, 15]
            quantized = Math.max(0, Math.min(15, Math.round(quantized)));
            
            pcmuData[i] = sign | (segment << 4) | quantized;
        }
        
        return pcmuData;
    }

    /*
    * Clean up resources
    */
    disconnect(): void {
        if (this.openAIService) {
            this.openAIService.disconnect();
        }
    }
}

export class BotResponse {
    disposition: BotTurnDisposition;
    text: string;
    confidence?: number;
    audioBytes?: Uint8Array;
    endSession?: boolean;

    constructor(disposition: BotTurnDisposition, text: string) {
        this.disposition = disposition;
        this.text = text;
    }

    withConfidence(confidence: number): BotResponse {
        this.confidence = confidence;
        return this;
    }

    withAudioBytes(audioBytes: Uint8Array): BotResponse {
        this.audioBytes = audioBytes;
        return this;
    }

    withEndSession(endSession: boolean): BotResponse {
        this.endSession = endSession;
        return this;
    }
}