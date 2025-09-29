import * as fs from 'fs';
import * as path from 'path';

export class InstructionLoaderService {
    private instructionsDir: string;
    private loadedInstructions: Map<string, string> = new Map();

    constructor() {
        this.instructionsDir = path.join(__dirname, '..', '..', 'instructions');
    }

    /**
     * Load instructions for a specific bot, including any included instructions
     */
    loadBotInstructions(instructionFileName: string): string {
        // Check cache first
        if (this.loadedInstructions.has(instructionFileName)) {
            return this.loadedInstructions.get(instructionFileName)!;
        }

        try {
            const instructionPath = path.join(this.instructionsDir, instructionFileName);
            
            if (!fs.existsSync(instructionPath)) {
                console.warn(`Instruction file not found: ${instructionFileName}`);
                return '';
            }

            const content = fs.readFileSync(instructionPath, 'utf8');
            const processedContent = this.processIncludes(content);
            
            // Cache the processed content
            this.loadedInstructions.set(instructionFileName, processedContent);
            
            console.log(`Successfully loaded instructions: ${instructionFileName}`);
            return processedContent;
        } catch (error) {
            console.error(`Error loading instruction file ${instructionFileName}:`, error);
            return '';
        }
    }

    /**
     * Process include directives in instruction files
     */
    private processIncludes(content: string): string {
        const includeRegex = /^# Included instructions\s*\n((?:- .+\.md\s*\n?)+)/gm;
        let processedContent = content;
        let match;

        while ((match = includeRegex.exec(content)) !== null) {
            const includeSection = match[1];
            const includeFiles = this.parseIncludeFiles(includeSection);
            
            let includedContent = '';
            for (const includeFile of includeFiles) {
                const includedInstructions = this.loadIncludedFile(includeFile);
                if (includedInstructions) {
                    includedContent += `\n\n# Included from ${includeFile}\n${includedInstructions}`;
                }
            }
            
            // Replace the include section with the actual included content
            processedContent = processedContent.replace(match[0], includedContent);
        }

        return processedContent;
    }

    /**
     * Parse include file names from the include section
     */
    private parseIncludeFiles(includeSection: string): string[] {
        const fileRegex = /- (.+\.md)/g;
        const files: string[] = [];
        let match;

        while ((match = fileRegex.exec(includeSection)) !== null) {
            files.push(match[1]);
        }

        return files;
    }

    /**
     * Load an included instruction file
     */
    private loadIncludedFile(fileName: string): string {
        try {
            const filePath = path.join(this.instructionsDir, fileName);
            
            if (!fs.existsSync(filePath)) {
                console.warn(`Included instruction file not found: ${fileName}`);
                return '';
            }

            const content = fs.readFileSync(filePath, 'utf8');
            console.log(`Loaded included instruction file: ${fileName}`);
            return content;
        } catch (error) {
            console.error(`Error loading included instruction file ${fileName}:`, error);
            return '';
        }
    }

    /**
     * Get predefined instruction sets
     */
    getGreetingInstructions(): string {
        return this.loadBotInstructions('Greeting_Agent_Instructions.md');
    }

    getIntentInstructions(): string {
        return this.loadBotInstructions('Intent_Agent_Instructions.md');
    }

    getHandoverInstructions(): string {
        // Create a default handover instruction if file doesn't exist
        const handoverFile = 'Handover_Agent_Instructions.md';
        const instructions = this.loadBotInstructions(handoverFile);
        
        if (!instructions) {
            return `# Handover Agent Instructions

## Included instructions
- Global_Agent_Instructions.md

## Handover Agent Instructions

Your role is to provide a professional handover message when transferring customers to human agents.

- Acknowledge that you understand their request
- Explain that you're transferring them to a specialist who can better assist them
- Thank them for their patience
- Keep the message brief and professional
- End the conversation after delivering the handover message`;
        }
        
        return instructions;
    }

    /**
     * Clear the instruction cache
     */
    clearCache(): void {
        this.loadedInstructions.clear();
        console.log('Instruction cache cleared');
    }
}