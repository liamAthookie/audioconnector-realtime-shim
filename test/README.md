# AudioConnector Test Client

This test client helps you verify your AudioConnector server is working correctly.

## Setup

1. Install dependencies:
   ```bash
   cd test
   npm install
   ```

## Running Tests

### Test Local Server
```bash
npm run test:local
```

### Test Remote Server (Fly.io)
```bash
# Update the URL in package.json first, then:
npm run test:remote
```

### Custom Test
```bash
TEST_SERVER_URL=wss://your-app.fly.dev TEST_API_KEY=ApiKey1 TEST_SECRET=Secret1 npm test
```

## What the Test Does

1. **Connects** to your AudioConnector server with proper authentication
2. **Sends Open Message** to start a session
3. **Sends Test Audio** (1 second of silence)
4. **Sends DTMF** digit "1"
5. **Sends Ping** to test connectivity
6. **Closes** the connection gracefully

## Expected Output

```
🚀 Starting AudioConnector test client
📍 Server URL: ws://localhost:8080
✅ Connected to AudioConnector server
📤 Sending message: open
📨 Received message: opened
🎵 Sending test audio data
📤 Sending message: dtmf
📤 Sending message: ping
📨 Received message: pong
📤 Sending message: close
📨 Received message: closed
🔌 Connection closed
```

## Troubleshooting

- **Authentication Failed**: Check your API key and secret match what's configured in your server
- **Connection Refused**: Make sure your server is running
- **OpenAI Errors**: Verify your `OPENAI_API_KEY` is set correctly