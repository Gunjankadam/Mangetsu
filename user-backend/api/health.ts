import { sendJson } from './_utils.js';

export default function handler(_req: any, res: any) {
  sendJson(res, 200, { ok: true, service: 'manga-flow-user-backend', ts: Date.now() });
}

