import Flagsmith from 'flagsmith-nodejs';

export class FlagsmithService {
    private flagsmith?: Flagsmith;
    private flagsCache: Map<string, any> = new Map();

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

    async refreshFlagsCache(): Promise<void> {
        if (!this.flagsmith) {
            return;
        }

        try {
            const flags = await this.flagsmith.getEnvironmentFlags();
            this.flagsCache.clear();
            
            // Cache all flags
            const flagNames = ['moderation-enabled']; // Add more flag names as needed
            for (const flagName of flagNames) {
                try {
                    const isEnabled = flags.isFeatureEnabled(flagName);
                    const value = flags.getFeatureValue(flagName);
                    this.flagsCache.set(`${flagName}_enabled`, isEnabled);
                    this.flagsCache.set(`${flagName}_value`, value);
                } catch (error) {
                    console.warn(`Failed to cache flag ${flagName}:`, error);
                }
            }
            
            console.log('Flagsmith flags cached successfully');
        } catch (error) {
            console.error('Failed to refresh Flagsmith flags cache:', error);
        }
    }

    async isFeatureEnabled(featureName: string, userId?: string): Promise<boolean> {
        if (!this.flagsmith) {
            console.warn(`Feature flag ${featureName} check failed - Flagsmith not initialized. Defaulting to false.`);
            return false;
        }

        // Try to get from cache first
        const cachedValue = this.flagsCache.get(`${featureName}_enabled`);
        if (cachedValue !== undefined) {
            console.log(`Feature flag ${featureName}: ${cachedValue} (from cache)`);
            return cachedValue;
        }

        // Fallback to direct API call if not in cache
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
        if (!this.flagsmith) {
            console.warn(`Feature flag ${featureName} value check failed - Flagsmith not initialized.`);
            return null;
        }

        // Try to get from cache first
        const cachedValue = this.flagsCache.get(`${featureName}_value`);
        if (cachedValue !== undefined) {
            return cachedValue !== undefined ? String(cachedValue) : null;
        }

        // Fallback to direct API call if not in cache
        try {
            let flags;
            if (userId) {
                flags = await this.flagsmith.getIdentityFlags(userId);
            } else {
                flags = await this.flagsmith.getEnvironmentFlags();
            }

            const value = flags.getFeatureValue(featureName);
            return value !== undefined ? String(value) : null;
        } catch (error) {
            console.error(`Error getting feature flag value ${featureName}:`, error);
            return null;
        }
    }
}