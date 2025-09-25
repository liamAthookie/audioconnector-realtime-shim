import { Flagsmith } from 'flagsmith-nodejs';

export class FlagsmithService {
    private flagsmith?: Flagsmith;
    private isInitialized = false;

    constructor() {
        const apiKey = process.env.FLAGSMITH_API_KEY;
        
        if (!apiKey) {
            console.warn('FLAGSMITH_API_KEY not provided. Feature flags will be disabled.');
            return;
        }

        this.flagsmith = new Flagsmith({
            environmentKey: apiKey,
        });
    }

    async initialize(): Promise<void> {
        if (!this.flagsmith || this.isInitialized) {
            return;
        }

        try {
            await this.flagsmith.getEnvironmentFlags();
            this.isInitialized = true;
            console.log('Flagsmith service initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Flagsmith service:', error);
            // Don't throw error - allow app to continue without feature flags
        }
    }

    async isFeatureEnabled(featureName: string, userId?: string): Promise<boolean> {
        if (!this.flagsmith || !this.isInitialized) {
            console.warn(`Feature flag ${featureName} check failed - Flagsmith not initialized. Defaulting to false.`);
            return false;
        }

        try {
            let flags;
            if (userId) {
                flags = await this.flagsmith.getIdentityFlags(userId);
            } else {
                flags = await this.flagsmith.getEnvironmentFlags();
            }

            const isEnabled = flags.isFeatureEnabled(featureName);
            
            console.log(`Feature flag ${featureName}: ${isEnabled}`);
            return isEnabled;
        } catch (error) {
            console.error(`Error checking feature flag ${featureName}:`, error);
            // Default to false if there's an error
            return false;
        }
    }

    async getFeatureValue(featureName: string, userId?: string): Promise<string | null> {
        if (!this.flagsmith || !this.isInitialized) {
            console.warn(`Feature flag ${featureName} value check failed - Flagsmith not initialized.`);
            return null;
        }

        try {
            let flags;
            if (userId) {
                flags = await this.flagsmith.getIdentityFlags(userId);
            } else {
                flags = await this.flagsmith.getEnvironmentFlags();
            }

            return flags.getFeatureValue(featureName);
            return value !== undefined ? String(value) : null;
        } catch (error) {
            console.error(`Error getting feature flag value ${featureName}:`, error);
            return null;
        }
    }
}