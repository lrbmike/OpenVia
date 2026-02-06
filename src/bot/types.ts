import { PendingRequest } from '../utils/permission-bridge'
import type { ContentBlock } from '../types/protocol'

export interface Channel {
  id: string;
  start(messageHandler: (input: string | ContentBlock[], userId: string, channelId: string, sendReply: (text: string) => Promise<void>) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
  handlePermissionRequest?(req: PendingRequest): Promise<void>;
}

export interface ChannelConfig {
  [key: string]: any;
}
