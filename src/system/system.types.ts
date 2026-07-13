export interface SystemStatus {
  webhookUrl: string;
  igConnected: boolean;
  igSessionExpiresAt: Date | null;
  lastSignalReceivedAt: Date | null;
  /** Whether POST /signal/test is usable — mirrors ENABLE_TEST_SIGNALS. */
  testSignalsEnabled: boolean;
}
