
export interface Channel {
  id: string;
  start(messageHandler: (input: string, userId: string, sendReply: (text: string) => Promise<void>) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
}

export interface ChannelConfig {
  [key: string]: any;
}
