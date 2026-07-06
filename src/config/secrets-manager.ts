import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({
  region: process.env.AWS_REGION || 'eu-west-2',
});

export async function loadSecrets(secretName: string) {
  const response = await client.send(
    new GetSecretValueCommand({
      SecretId: secretName,
    }),
  );

  if (!response.SecretString) {
    throw new Error('Secret not found');
  }

  return JSON.parse(response.SecretString);
}
