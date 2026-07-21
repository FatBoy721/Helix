import { createHash, randomBytes } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onRequest } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2/options';

setGlobalOptions({ region: 'us-east1', maxInstances: 10 });
if (!getApps().length) initializeApp();

const firestore = getFirestore();
const messaging = getMessaging();
const devices = firestore.collection('helixDevices');
const events = new Set(['complete', 'failed', 'error', 'cancelled', 'paused', 'runout', 'swap']);

interface RegisterRequest {
  deviceToken?: unknown;
  printerId?: unknown;
}

interface TestNotificationRequest {
  deviceToken?: unknown;
}

function json(res: Parameters<typeof onRequest>[0] extends never ? never : any, status: number, body: unknown) {
  res.status(status).set('Content-Type', 'application/json').send(body);
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function cleanText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 500) : fallback;
}

function eventFromRequest(req: any): string {
  const value = req.query?.event;
  return typeof value === 'string' && events.has(value) ? value : 'error';
}

export const relay = onRequest(async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    json(res, 405, { error: 'method_not_allowed' });
    return;
  }

  const path = String(req.path || req.url || '');
  if (path.endsWith('/v1/register') || path === '/register') {
    const body = (req.body || {}) as RegisterRequest;
    const deviceToken = cleanText(body.deviceToken, '');
    const printerId = cleanText(body.printerId, '');
    if (!deviceToken || !printerId) {
      json(res, 400, { error: 'deviceToken_and_printerId_required' });
      return;
    }

    const secret = randomBytes(32).toString('base64url');
    await devices.doc(hashSecret(secret)).set({
      deviceToken,
      printerId,
      enabled: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const base = `${req.protocol}://${req.get('host')}`;
    json(res, 200, {
      webhookUrl: `${base}/relay/v1/events/${encodeURIComponent(secret)}`,
    });
    return;
  }

  if (path.endsWith('/v1/test') || path === '/test') {
    const body = (req.body || {}) as TestNotificationRequest;
    const deviceToken = cleanText(body.deviceToken, '');
    if (!deviceToken) {
      json(res, 400, { error: 'deviceToken_required' });
      return;
    }

    try {
      await messaging.send({
        token: deviceToken,
        notification: {
          title: 'Helix test',
          body: 'Firebase push notifications are working.',
        },
        data: { type: 'helix_test' },
        android: { priority: 'high' },
      });
      json(res, 202, { accepted: true });
    } catch {
      json(res, 502, { error: 'fcm_delivery_failed' });
    }
    return;
  }

  const match = path.match(/\/v1\/events\/([^/]+)$/);
  if (!match) {
    json(res, 404, { error: 'not_found' });
    return;
  }

  const snapshot = await devices.doc(hashSecret(decodeURIComponent(match[1]))).get();
  if (!snapshot.exists || snapshot.data()?.enabled !== true) {
    json(res, 404, { error: 'unknown_device' });
    return;
  }

  const device = snapshot.data() as { deviceToken: string; printerId: string };
  const body = typeof req.body === 'object' && req.body ? req.body : {};
  const event = eventFromRequest(req);
  const title = cleanText(
    req.headers['x-title'] || body.title || req.query?.title,
    `Helix printer ${event}`
  );
  const message = cleanText(
    req.headers['x-message'] || body.body || req.query?.body || req.body,
    'Printer event received.'
  );
  console.info('Helix printer event received', { event, printerId: device.printerId });

  try {
    await messaging.send({
      token: device.deviceToken,
      notification: { title, body: message },
      data: {
        type: 'printer_event',
        event,
        printerId: device.printerId,
        title,
        body: message,
        route: '/',
      },
      android: { priority: 'high' },
    });
    await snapshot.ref.update({ lastDeliveredAt: FieldValue.serverTimestamp() });
    json(res, 202, { accepted: true });
  } catch (error: any) {
    const code = String(error?.code || '');
    console.error('Helix FCM delivery failed', {
      event,
      printerId: device.printerId,
      code,
      message: error?.message || String(error),
    });
    if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')) {
      await snapshot.ref.update({ enabled: false, disabledAt: FieldValue.serverTimestamp() });
    }
    json(res, 502, { error: 'fcm_delivery_failed' });
  }
});
