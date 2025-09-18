# AudioConnector Server Reference Guide

### ¯\_(ツ)_/¯

### Overview
This repository contains a production-ready AudioConnector Server integrated with OpenAI's Realtime API (stable release). The server provides real-time voice AI capabilities for customer service applications and can be deployed to Fly.io using GitHub Actions.

### Purpose
This repository contains a reference implementation for an AudioConnector Server integrated with OpenAI's Realtime API. This implementation demonstrates how to set up an AudioConnector Server with real-time AI voice capabilities. Protocol documentation can be found on the [Genesys Developer Portal](https://developer.genesys.cloud/devapps/audiohook/).

### Features
- **Real-time Audio Processing**: Direct audio streaming to OpenAI without intermediate transcription
- **Voice Activity Detection**: OpenAI's built-in VAD for natural conversation flow
- **Configurable Voice**: Multiple OpenAI voice options (alloy, echo, fable, onyx, nova, shimmer)
- **Production Ready**: Docker containerization and Fly.io deployment
- **Auto-scaling**: Scales to zero when not in use to minimize costs
- **Health Monitoring**: Built-in health checks and graceful shutdown

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

### Deployment to Fly.io

This project includes automated deployment to Fly.io using GitHub Actions.

#### Prerequisites
1. [Fly.io account](https://fly.io/app/sign-up)
2. [Fly CLI installed](https://fly.io/docs/hands-on/install-flyctl/)
3. GitHub repository with Actions enabled

#### Setup Deployment

1. **Authenticate with Fly.io**:
   ```bash
   flyctl auth login
   ```

2. **Get your Fly.io API token**:
   ```bash
   flyctl auth token
   ```

3. **Add GitHub Secrets**:
   - Go to your GitHub repository → Settings → Secrets and variables → Actions
   - Add these repository secrets:
     - `FLY_API_TOKEN`: Your Fly.io API token
     - `OPENAI_API_KEY`: Your OpenAI API key

4. **Initialize your Fly.io app** (one-time setup):
   ```bash
   flyctl launch --no-deploy
   ```

5. **Deploy**:
   ```bash
   git push origin main
   ```

The GitHub Actions workflow will automatically build and deploy your application to Fly.io whenever you push to the main branch.

#### Monitoring Your Deployment
- **View logs**: `flyctl logs`
- **Check status**: `flyctl status`
- **Scale app**: `flyctl scale count 1` (or 0 to stop)
- **View metrics**: Available in the Fly.io dashboard

### OpenAI Realtime API Integration

This implementation uses OpenAI's Realtime API stable release (`gpt-4o-realtime-preview-2024-12-17`) to provide:
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

### Architecture

```
┌─────────────────┐    WebSocket     ┌──────────────────┐    WebSocket    ┌─────────────────┐
│ Genesys Cloud   │◄────────────────►│ AudioConnector   │◄───────────────►│ OpenAI Realtime │
│ AudioConnector  │   PCMU Audio     │ Server           │   PCM16 Audio   │ API             │
│ Client          │   + Control      │ (This App)       │   + Control     │                 │
└─────────────────┘                  └──────────────────┘                 └─────────────────┘
```

### Cost Optimization

The Fly.io deployment is configured for cost efficiency:
- **Auto-stop machines**: Automatically stops when not in use
- **Scale to zero**: No charges when idle
- **Minimal resources**: 512MB RAM, shared CPU
- **Health checks**: Ensures reliability while minimizing resource usage

### Support

For questions about the AudioConnector protocol, visit the [Genesys Developer Portal](https://developer.genesys.cloud/devapps/audiohook/).

For OpenAI Realtime API documentation, visit [OpenAI's documentation](https://platform.openai.com/docs/guides/realtime).