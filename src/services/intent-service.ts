export interface SupportedIntent {
    name: string;
    description: string;
    botInstructionsFile?: string;
}

export class IntentService {
    private supportedIntents: Map<string, SupportedIntent> = new Map();

    constructor() {
        this.loadSupportedIntents();
    }

    private loadSupportedIntents(): void {
        // Add cancel subscription intent
        this.supportedIntents.set('cancel_subscription', {
            name: 'cancel_subscription',
            description: 'Handle subscription cancellation requests',
            botInstructionsFile: 'Cancel_Subscription_Agent_Instructions.md'
        });
        
        console.log(`Loaded ${this.supportedIntents.size} supported intents`);
    }

    getSupportedIntents(): SupportedIntent[] {
        return Array.from(this.supportedIntents.values());
    }

    isIntentSupported(intent: string): boolean {
        return this.supportedIntents.has(intent);
    }

    getIntentConfig(intent: string): SupportedIntent | null {
        return this.supportedIntents.get(intent) || null;
    }

    addSupportedIntent(intent: SupportedIntent): void {
        this.supportedIntents.set(intent.name, intent);
        console.log(`Added supported intent: ${intent.name}`);
    }

    removeSupportedIntent(intentName: string): void {
        this.supportedIntents.delete(intentName);
        console.log(`Removed supported intent: ${intentName}`);
    }
}