import * as SecureStore from 'expo-secure-store';
import {
  bespok3dCredentialStorageKey,
  normalizeBespok3dCredentialRecord,
  type Bespok3dCredentialRecord,
} from './bespok3dCredentials';

export async function readBespok3dCredentialRecord(
  printerId: string,
): Promise<Bespok3dCredentialRecord | null> {
  const key = bespok3dCredentialStorageKey(printerId);
  const serialized = await SecureStore.getItemAsync(key);
  if (!serialized) return null;
  const parsed = (() => {
    try {
      return JSON.parse(serialized) as unknown;
    } catch {
      return null;
    }
  })();
  const record = normalizeBespok3dCredentialRecord(parsed);
  if (!record || record.printerId !== printerId) {
    await SecureStore.deleteItemAsync(key);
    return null;
  }
  return record;
}

export async function writeBespok3dCredentialRecord(
  record: Bespok3dCredentialRecord,
): Promise<void> {
  const normalized = normalizeBespok3dCredentialRecord(record);
  if (!normalized) throw new Error('Bespok3d credentials are invalid.');
  await SecureStore.setItemAsync(
    bespok3dCredentialStorageKey(record.printerId),
    JSON.stringify(normalized),
  );
}

export async function deleteBespok3dCredentialRecord(printerId: string): Promise<void> {
  await SecureStore.deleteItemAsync(bespok3dCredentialStorageKey(printerId));
}
