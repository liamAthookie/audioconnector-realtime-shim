# AudioConnector Server Reference Guide

### Purpose
This repository contains a sample implementation for an AudioConnector Server integrated with OpenAI's Realtime API. This is to be used as a guide to help understand some of the basics of setting up an AudioConnector Server with real-time AI voice capabilities. It is not intended for production purposes. Protocol documentation can be found on the [Genesys Developer Portal](https://developer.genesys.cloud/devapps/audiohook/).

### Things to look at to get started

#### The main session object
The [Session](./src/common/session.ts) class contains methods and logic that handle communicating with the AudioConnector Client.

The [OpenAIRealtimeService](./src/services/openai-realtime-service.ts) class is responsible for handling real-time audio communication with OpenAI's API, including speech recognition, natural language processing, and text-to-speech generation.

The [BotService](./src/services/bot-service.ts) class is responsible for getting the metadata for a specified Bot, as well as interacting with the Bot itself using OpenAI's Realtime API. This service handles both audio and text-based interactions with the AI assistant.

The [ASRService](./src/services/asr-service.ts) class is responsible for interpreting the incoming audio from the AudioConnector Server. This is now used as a fallback when OpenAI Realtime API is not available.

The [DTMFService](./src/services/dtmf-service.ts) class is responsible for interpreting any DTMF digits received from the AudioConnector Client. A base implementation has been provded as a start, but will need to be adjusted to meet any specific requirements for the AudioConnector Server.

The [SecretService](./src/services/secret-service.ts) class is responsible for looking up the secret from a given API Key used during the initial authentication process. A fake implementation has been provided, and will need to be replaced to lookup secrets with whatever service they are stored in.

The [TTSService](./src/services/tts-service.ts) class is responsible for converting text-based responses from the Bot to the appropriate audio to be sent to the AudioConnector Client. This is now handled by the OpenAI Realtime API but kept as a fallback option.

### Running the server

#### Requirements
This implementation was written using NodeJS 18.16.0 as a target. If you are using a Node version manager, there is a [nvmrc](./.nvmrc) file that specifies this version.

#### Environment Setup
1) Copy `.env.example` to `.env`
2) Add your OpenAI API key to the `.env` file:
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   ```
3) Configure any additional authentication secrets as needed

#### Steps to run the server locally
1) Run `npm install` in the root of the project.
2) Ensure your `.env` file is properly configured with your OpenAI API key
3) Run `npm run start` in the root of the project to start the server. The port can be adjusted from within the [environment](./.env) file.

### OpenAI Realtime API Integration

This implementation uses OpenAI's Realtime API to provide:
- Real-time speech recognition
- Natural language understanding and processing
- Text-to-speech generation
- Conversational AI capabilities

The system automatically handles audio format conversion between the AudioConnector's PCMU format and OpenAI's PCM16 format.

#### Key Features:
- **Real-time Audio Processing**: Direct audio streaming to OpenAI without intermediate transcription steps
- **Voice Activity Detection**: OpenAI's built-in VAD for natural conversation flow
- **Configurable Voice**: Choose from multiple OpenAI voice options (alloy, echo, fable, onyx, nova, shimmer)
- **Error Handling**: Robust error handling with fallback responses
- **Session Management**: Proper cleanup and resource management