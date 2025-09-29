import { ClientMessage } from '../../../protocol/message';
import { Session } from '../../../common/session';
import { MessageHandler } from '../message-handler';

export class PingMessageHandler implements MessageHandler {
    handle(message: ClientMessage, session: Session): void {
        session.send(session.createMessage('pong', {}));
    }
}