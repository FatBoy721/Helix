import type {
  Bespok3dPreparedEnrollment,
  Bespok3dU1EnrollmentResult,
} from './bespok3d';

export const BESPOK3D_CREDENTIAL_RECORD_VERSION = 1;

interface Bespok3dCredentialRecordBase extends Bespok3dPreparedEnrollment {
  version: typeof BESPOK3D_CREDENTIAL_RECORD_VERSION;
  printerId: string;
  sshHostKeySha256: string;
  label: string;
}

export interface Bespok3dPreparedCredentialRecord extends Bespok3dCredentialRecordBase {
  status: 'prepared';
}

export interface Bespok3dEnrolledCredentialRecord extends Bespok3dCredentialRecordBase {
  status: 'enrolled';
  certificatePem: string;
  certificateSha256: string;
  daemonVersion: string;
  jinniVersion: string;
}

export type Bespok3dCredentialRecord =
  | Bespok3dPreparedCredentialRecord
  | Bespok3dEnrolledCredentialRecord;

const IDENTITY = /^helix-[a-f0-9-]{36}$/;
const TOKEN = /^[a-f0-9]{64}$/;
const SSH_FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/;
const CERTIFICATE_FINGERPRINT = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const PRINTER_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function bespok3dCredentialStorageKey(printerId: string): string {
  if (!PRINTER_ID.test(printerId)) throw new Error('Printer identity is invalid.');
  return `helix.bespok3d.${printerId}`;
}

export function createPreparedBespok3dCredentialRecord(
  printerId: string,
  sshHostKeySha256: string,
  label: string,
  credentials: Bespok3dPreparedEnrollment,
): Bespok3dPreparedCredentialRecord {
  const normalized = normalizeBespok3dCredentialRecord({
    version: BESPOK3D_CREDENTIAL_RECORD_VERSION,
    status: 'prepared',
    printerId,
    sshHostKeySha256,
    label,
    ...credentials,
  });
  if (normalized?.status !== 'prepared') throw new Error('Prepared Bespok3d credentials are invalid.');
  return normalized;
}

export function createEnrolledBespok3dCredentialRecord(
  prepared: Bespok3dPreparedCredentialRecord,
  result: Bespok3dU1EnrollmentResult,
): Bespok3dEnrolledCredentialRecord {
  const normalized = normalizeBespok3dCredentialRecord({
    ...prepared,
    status: 'enrolled',
    certificatePem: result.certificatePem,
    certificateSha256: result.certificateSha256,
    daemonVersion: result.daemonVersion,
    jinniVersion: result.jinniVersion,
  });
  if (normalized?.status !== 'enrolled') throw new Error('Enrolled Bespok3d credentials are invalid.');
  return normalized;
}

export function normalizeBespok3dCredentialRecord(
  raw: unknown,
): Bespok3dCredentialRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.version !== BESPOK3D_CREDENTIAL_RECORD_VERSION) return null;
  if (record.status !== 'prepared' && record.status !== 'enrolled') return null;
  if (typeof record.printerId !== 'string' || !PRINTER_ID.test(record.printerId)) return null;
  if (typeof record.identity !== 'string' || !IDENTITY.test(record.identity)) return null;
  if (typeof record.token !== 'string' || !TOKEN.test(record.token)) return null;
  if (
    typeof record.sshHostKeySha256 !== 'string'
    || !SSH_FINGERPRINT.test(record.sshHostKeySha256)
  ) return null;
  if (
    typeof record.label !== 'string'
    || !record.label.trim()
    || record.label.length > 64
    || [...record.label].some((character) => /[\u0000-\u001f\u007f]/.test(character))
  ) return null;

  const base: Bespok3dCredentialRecordBase = {
    version: BESPOK3D_CREDENTIAL_RECORD_VERSION,
    printerId: record.printerId,
    identity: record.identity,
    token: record.token,
    sshHostKeySha256: record.sshHostKeySha256,
    label: record.label,
  };
  if (record.status === 'prepared') return { ...base, status: 'prepared' };

  if (
    typeof record.certificatePem !== 'string'
    || !record.certificatePem.includes('-----BEGIN CERTIFICATE-----')
    || typeof record.certificateSha256 !== 'string'
    || !CERTIFICATE_FINGERPRINT.test(record.certificateSha256)
    || typeof record.daemonVersion !== 'string'
    || !record.daemonVersion.trim()
    || typeof record.jinniVersion !== 'string'
    || !record.jinniVersion.trim()
  ) return null;
  return {
    ...base,
    status: 'enrolled',
    certificatePem: record.certificatePem,
    certificateSha256: record.certificateSha256,
    daemonVersion: record.daemonVersion,
    jinniVersion: record.jinniVersion,
  };
}
