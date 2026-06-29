export interface SystemStatus {
  webhookUrl: string;
  igConnected: boolean;
  igSessionExpiresAt: Date | null;
}
