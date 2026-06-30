export interface IgSecrets {
  IG_API_KEY: string;
  IG_USERNAME: string;
  IG_PASSWORD: string;
}

export interface AppSecrets {
  DB_PASSWORD: string;
  JWT_SECRET: string;
  WEBHOOK_SECRET: string;
}

export type SecretKey = keyof IgSecrets | keyof AppSecrets;
