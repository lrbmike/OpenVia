import { PendingRequest } from '../utils/permission-bridge'

export interface Channel {
  id: string;
  start(messageHandler: (input: string, userId: string, channelId: string, sendReply: (text: string) => Promise<void>) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
  handlePermissionRequest?(req: PendingRequest): Promise<void>;
}

export interface ChannelConfig {
  [key: string]: any;
}
