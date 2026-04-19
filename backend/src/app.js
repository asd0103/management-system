import express from 'express';
import cors from 'cors';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { upload } from './upload.js';

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const realtimeClients = new Set();
const REALTIME_RETRY_MS = 1500;
const REALTIME_HEARTBEAT_MS = 25000;

const writeSseEvent = (res, event, data) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${data}\n\n`);
};

const broadcastRealtimeEvent = (channel, detail = {}) => {
  const normalizedChannel = String(channel || '').trim();
  if (!normalizedChannel || !realtimeClients.size) return;
  const payload = JSON.stringify({
    channel: normalizedChannel,
    sentAt: new Date().toISOString(),
    ...detail,
  });
  for (const client of [...realtimeClients]) {
    try {
      writeSseEvent(client, 'sync', payload);
    } catch (error) {
      console.error('Realtime client write failed', error);
      realtimeClients.delete(client);
      try {
        client.end();
      } catch {
        // Ignore client cleanup failures.
      }
    }
  }
};

let dbLoadPromise = null;
const shouldExposeDbError = process.env.SHIYI_DEBUG_ERRORS === '1';

const loadDb = async () => {
  if (!dbLoadPromise) {
    dbLoadPromise = import('./db.js')
      .then((module) => module.default)
      .catch((error) => {
        dbLoadPromise = null;
        throw error;
      });
  }

  return dbLoadPromise;
};

const withDb = (handler) => async (req, res) => {
  let db;

  try {
    db = await loadDb();
  } catch (error) {
    console.error('Database unavailable', error);
    res.status(503).json({
      ok: false,
      message: 'database unavailable',
      error: shouldExposeDbError ? String(error?.message ?? error) : undefined,
    });
    return;
  }

  try {
    await handler(db, req, res);
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, message: 'internal server error' });
  }
};

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'shihyi-system-backend',
  });
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write(`retry: ${REALTIME_RETRY_MS}\n\n`);
  writeSseEvent(res, 'ready', JSON.stringify({
    ok: true,
    sentAt: new Date().toISOString(),
  }));
  realtimeClients.add(res);
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(heartbeat);
      realtimeClients.delete(res);
    }
  }, REALTIME_HEARTBEAT_MS);
  req.on('close', () => {
    clearInterval(heartbeat);
    realtimeClients.delete(res);
    res.end();
  });
});

const quoteSelect = `
  SELECT q.*, c.company AS customer_company, c.contact AS customer_contact
  FROM quotes q
  JOIN customers c ON c.id = q.customer_id
`;

const mapCustomerRow = (row) => ({
  id: row.id,
  company: row.company,
  contact: row.contact,
  phone: row.phone ?? '',
  email: row.email ?? '',
  taxId: row.tax_id ?? '',
  address: row.address ?? '',
  owner: row.owner ?? '',
  note: row.note ?? '',
  status: row.status ?? 'active',
  version: Number(row.version ?? 1),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapQuoteRow = (row) => ({
  id: row.id,
  number: row.number,
  customerId: row.customer_id,
  customerName: row.customer_name,
  contact: row.contact,
  owner: row.owner,
  project: row.project,
  status: row.status,
  quoteDate: row.quote_date ?? '',
  validUntil: row.valid_until ?? '',
  eventDate: row.event_date ?? '',
  taxRate: Number(row.tax_rate ?? 0),
  discount: row.discount,
  note: row.note ?? '',
  items: JSON.parse(row.items_json ?? '[]'),
  attachments: JSON.parse(row.attachments_json ?? '[]'),
  history: JSON.parse(row.history_json ?? '[]'),
  version: Number(row.version ?? 1),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const saveQuoteHistory = async (db, quoteId, action, note, actor = 'system') => {
  await db.run(
    `
      INSERT INTO quote_history (quote_id, action, note, actor)
      VALUES (?, ?, ?, ?)
    `,
    [quoteId, action, note ?? '', actor],
  );
};

const AUTH_USER_SEED = { name: 'Allen', account: 'asd', password: '000', role: '\u7ba1\u7406\u8005', department: '\u71df\u904b\u7ba1\u7406', active: 1 };
const LEGACY_AUTH_ACCOUNTS = ['amber', 'victor', 'mia', 'kevin'];
const mapAuthUserRow = (row) => ({
  id: row.id,
  name: row.name,
  account: row.account,
  role: row.role,
  department: row.department ?? '',
  active: Number(row.active ?? 1) !== 0,
  history: JSON.parse(row.history_json ?? '[]'),
  version: Number(row.version ?? 1),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const AUTH_PASSWORD_PREFIX = 'scrypt';
const hashAuthPassword = (password) => {
  const normalizedPassword = String(password || '');
  const salt = randomBytes(16).toString('hex');
  const derivedKey = scryptSync(normalizedPassword, salt, 64).toString('hex');
  return `${AUTH_PASSWORD_PREFIX}$${salt}$${derivedKey}`;
};
const isHashedAuthPassword = (value) => String(value || '').startsWith(`${AUTH_PASSWORD_PREFIX}$`);
const verifyAuthPassword = (password, storedPassword) => {
  const plainPassword = String(password || '');
  const savedPassword = String(storedPassword || '');
  if (!savedPassword) return false;
  if (!isHashedAuthPassword(savedPassword)) {
    return plainPassword === savedPassword;
  }
  const [, salt, expectedHash] = savedPassword.split('$');
  if (!salt || !expectedHash) return false;
  const actualHash = scryptSync(plainPassword, salt, 64);
  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  if (actualHash.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualHash, expectedBuffer);
};
const resolveAuthPasswordForStorage = (incomingPassword, fallbackPassword = '') => {
  const nextPassword = String(incomingPassword || '').trim();
  if (nextPassword) {
    return hashAuthPassword(nextPassword);
  }
  return String(fallbackPassword || '');
};

const authUserHistoryJson = (value) => JSON.stringify(Array.isArray(value) ? value : []);

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const claimsJson = (value) => JSON.stringify(Array.isArray(value) ? value : []);
const payoutsJson = (value) => JSON.stringify(Array.isArray(value) ? value : []);

const mapRuntimeStateRow = (row) => ({
  key: row.state_key,
  value: JSON.parse(row.state_json || 'null'),
  version: Number(row.version ?? 1),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapClaimRow = (row) => {
  const receipts = parseJsonArray(row.receipts_json);
  const firstReceipt = receipts[0] || {};
  return {
    id: row.id,
    title: row.title,
    amount: Number(row.amount ?? 0),
    reason: row.reason ?? '',
    content: row.content ?? '',
    receiptName: row.receipt_name ?? firstReceipt.name ?? '',
    receiptPreview: row.receipt_preview ?? firstReceipt.preview ?? '',
    receiptType: row.receipt_type ?? firstReceipt.type ?? '',
    receipts,
    payoutAt: row.payout_at ?? '',
    applicant: row.applicant ?? '',
    applicantRole: row.applicant_role ?? '',
    reviewer: row.reviewer ?? '',
    reviewedAt: row.reviewed_at ?? '',
    status: row.status ?? 'pending',
    returnReason: row.return_reason ?? '',
    payoutCompletedAt: row.payout_completed_at ?? '',
    payoutCompletedBy: row.payout_completed_by ?? '',
    history: parseJsonArray(row.history_json),
    version: Number(row.version ?? 1),
    createdAt: row.created_label ?? row.created_at,
    updatedAt: row.updated_label ?? row.updated_at,
  };
};

const mapPayoutRow = (row) => {
  const proofs = parseJsonArray(row.proofs_json);
  const firstProof = proofs[0] || {};
  return {
    id: row.id,
    title: row.title,
    amount: Number(row.amount ?? 0),
    applicant: row.applicant ?? '',
    deadline: row.deadline ?? '',
    detail: row.detail ?? '',
    status: row.status ?? 'pending',
    proof: row.proof ?? firstProof.name ?? '',
    proofPreview: row.proof_preview ?? firstProof.preview ?? '',
    proofType: row.proof_type ?? firstProof.type ?? '',
    proofs,
    returnReason: row.return_reason ?? '',
    completedAt: row.completed_at ?? '',
    completedBy: row.completed_by ?? '',
    history: parseJsonArray(row.history_json),
    sourceType: row.source_type ?? '',
    sourceId: row.source_id ?? '',
    version: Number(row.version ?? 1),
    createdAt: row.created_label ?? row.created_at,
    updatedAt: row.updated_label ?? row.updated_at,
  };
};

const parseExpectedVersion = (payload = {}) => {
  if (!Object.prototype.hasOwnProperty.call(payload, 'expectedVersion')) return null;
  const parsed = Number(payload.expectedVersion);
  return Number.isFinite(parsed) ? parsed : null;
};

const sendVersionConflict = (res, message, item = null) => {
  res.status(409).json({ ok: false, message, item });
};

const ensureDefaultAuthUsers = async (db) => {
  if (LEGACY_AUTH_ACCOUNTS.length > 0) {
    await db.run(
      `DELETE FROM auth_users WHERE account IN (?, ?, ?, ?)`,
      LEGACY_AUTH_ACCOUNTS,
    );
  }

  await db.run(
    `
      INSERT INTO auth_users (name, account, password, role, department, active, history_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        role = VALUES(role),
        department = VALUES(department),
        active = VALUES(active)
    `,
    [
      AUTH_USER_SEED.name,
      AUTH_USER_SEED.account,
      hashAuthPassword(AUTH_USER_SEED.password),
      AUTH_USER_SEED.role,
      AUTH_USER_SEED.department,
      AUTH_USER_SEED.active,
      '[]',
    ],
  );
};

app.get('/api/auth/users', withDb(async (db, _req, res) => {
  await ensureDefaultAuthUsers(db);
  const rows = await db.all('SELECT * FROM auth_users ORDER BY id ASC');
  res.json({ ok: true, items: rows.map(mapAuthUserRow) });
}));

app.post('/api/auth/users', withDb(async (db, req, res) => {
  const payload = req.body ?? {};
  const account = String(payload.account || '').trim();
  const name = String(payload.name || '').trim();
  const password = String(payload.password || '');

  if (!account || !name || !password) {
    res.status(400).json({ ok: false, message: 'name, account and password are required' });
    return;
  }

  await ensureDefaultAuthUsers(db);

  const exists = await db.get('SELECT id FROM auth_users WHERE account = ? LIMIT 1', [account]);
  if (exists) {
    res.status(409).json({ ok: false, message: 'account already exists' });
    return;
  }

  const result = await db.run(
    `
      INSERT INTO auth_users (name, account, password, role, department, active, history_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      [
        name,
        account,
        hashAuthPassword(password),
        String(payload.role || '員工'),
        String(payload.department || ''),
        payload.active === false ? 0 : 1,
      authUserHistoryJson(payload.history),
    ],
  );

  const row = await db.get('SELECT * FROM auth_users WHERE id = ? LIMIT 1', [result.insertId]);
  broadcastRealtimeEvent('shihyi_users', { scope: 'users', action: 'created', account });
  res.status(201).json({ ok: true, item: mapAuthUserRow(row) });
}));

app.put('/api/auth/users', withDb(async (db, req, res) => {
  const payload = req.body ?? {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  const replaceMissing = payload.replaceMissing === true;

  await ensureDefaultAuthUsers(db);
  for (const item of items) {
    const account = String(item?.account || '').trim();
    const name = String(item?.name || '').trim();
    if (!account || !name) continue;
    const existing = await db.get('SELECT password FROM auth_users WHERE account = ? LIMIT 1', [account]);
    const nextPassword = resolveAuthPasswordForStorage(item?.password, existing?.password);
    if (!nextPassword) {
      res.status(400).json({ ok: false, message: `password is required for ${account}` });
      return;
    }
    await db.run(
      `
        INSERT INTO auth_users (name, account, password, role, department, active, history_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          password = VALUES(password),
          role = VALUES(role),
          department = VALUES(department),
          active = VALUES(active),
          history_json = VALUES(history_json),
          version = auth_users.version + 1
      `,
      [
        name,
        account,
        nextPassword,
        String(item?.role || '??芣扔'),
        String(item?.department || ''),
        item?.active === false ? 0 : 1,
        authUserHistoryJson(item?.history),
      ],
    );
  }

  if (replaceMissing) {
    const accountsToKeep = new Set(items.map((item) => String(item?.account || '').trim()).filter(Boolean));
    accountsToKeep.add(AUTH_USER_SEED.account);
    const placeholders = Array.from(accountsToKeep).map(() => '?').join(', ');
    await db.run(
      `DELETE FROM auth_users WHERE account NOT IN (${placeholders})`,
      Array.from(accountsToKeep),
    );
  }

  const rows = await db.all('SELECT * FROM auth_users ORDER BY id ASC');
  broadcastRealtimeEvent('shihyi_users', { scope: 'users', action: replaceMissing ? 'replace' : 'batch-update' });
  res.json({ ok: true, items: rows.map(mapAuthUserRow) });
}));

app.get('/api/auth/users/:account', withDb(async (db, req, res) => {
  await ensureDefaultAuthUsers(db);
  const account = String(req.params.account || '').trim();
  const row = await db.get('SELECT * FROM auth_users WHERE account = ? LIMIT 1', [account]);
  if (!row) {
    res.status(404).json({ ok: false, message: 'auth user not found' });
    return;
  }
  res.json({ ok: true, item: mapAuthUserRow(row) });
}));

app.put('/api/auth/users/:account', withDb(async (db, req, res) => {
  const targetAccount = String(req.params.account || '').trim();
  const payload = req.body ?? {};
  const nextAccount = String(payload.account || targetAccount).trim();
  const nextName = String(payload.name || '').trim();
  const expectedVersion = parseExpectedVersion(payload);

  if (!targetAccount || !nextAccount || !nextName) {
    res.status(400).json({ ok: false, message: 'name and account are required' });
    return;
  }

  await ensureDefaultAuthUsers(db);

  const exists = await db.get('SELECT * FROM auth_users WHERE account = ? LIMIT 1', [targetAccount]);
  if (!exists) {
    res.status(404).json({ ok: false, message: 'auth user not found' });
    return;
  }
  if (expectedVersion !== null && Number(exists.version ?? 1) !== expectedVersion) {
    sendVersionConflict(res, 'auth user version conflict', mapAuthUserRow(exists));
    return;
  }

  const nextHistoryJson = authUserHistoryJson(
    Object.prototype.hasOwnProperty.call(payload, 'history')
      ? payload.history
      : JSON.parse(exists.history_json || '[]'),
  );
  const nextPassword = resolveAuthPasswordForStorage(payload.password, exists.password);
  if (!nextPassword) {
    res.status(400).json({ ok: false, message: 'password is required' });
    return;
  }

  await db.run(
    `
      UPDATE auth_users
      SET name = ?,
          account = ?,
          password = ?,
          role = ?,
          department = ?,
          active = ?,
          history_json = ?,
          version = version + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE account = ?
    `,
      [
        nextName,
        nextAccount,
        nextPassword,
        String(payload.role || '??芣扔'),
        String(payload.department || ''),
        payload.active === false ? 0 : 1,
      nextHistoryJson,
      targetAccount,
    ],
  );

  const row = await db.get('SELECT * FROM auth_users WHERE account = ? LIMIT 1', [nextAccount]);
  broadcastRealtimeEvent('shihyi_users', { scope: 'users', action: 'updated', account: nextAccount });
  res.json({ ok: true, item: mapAuthUserRow(row) });
}));

app.delete('/api/auth/users/:account', withDb(async (db, req, res) => {
  const account = String(req.params.account || '').trim();
  const payload = req.body ?? {};
  const expectedVersion = parseExpectedVersion(payload);
  if (!account) {
    res.status(400).json({ ok: false, message: 'account is required' });
    return;
  }

  await ensureDefaultAuthUsers(db);

  const row = await db.get('SELECT * FROM auth_users WHERE account = ? LIMIT 1', [account]);
  if (!row) {
    res.status(404).json({ ok: false, message: 'auth user not found' });
    return;
  }
  if (expectedVersion !== null && Number(row.version ?? 1) !== expectedVersion) {
    sendVersionConflict(res, 'auth user version conflict', mapAuthUserRow(row));
    return;
  }

  const adminCount = await db.get(
    'SELECT COUNT(*) AS count FROM auth_users WHERE role = ? AND active <> 0',
    [AUTH_USER_SEED.role],
  );
  if (row.role === AUTH_USER_SEED.role && Number(adminCount?.count || 0) <= 1) {
    res.status(409).json({ ok: false, message: 'last admin cannot be deleted' });
    return;
  }

  await db.run('DELETE FROM auth_users WHERE account = ?', [account]);
  broadcastRealtimeEvent('shihyi_users', { scope: 'users', action: 'deleted', account });
  res.json({ ok: true });
}));

app.get('/api/runtime-state/:key', withDb(async (db, req, res) => {
  const key = String(req.params.key || '').trim();
  if (!key) {
    res.status(400).json({ ok: false, message: 'state key is required' });
    return;
  }

  const row = await db.get('SELECT * FROM runtime_state WHERE state_key = ? LIMIT 1', [key]);
  broadcastRealtimeEvent(key, { scope: 'runtime-state', action: existing ? 'updated' : 'created' });
  res.json({ ok: true, item: row ? mapRuntimeStateRow(row) : null });
}));

app.put('/api/runtime-state/:key', withDb(async (db, req, res) => {
  const key = String(req.params.key || '').trim();
  const payload = req.body ?? {};
  const expectedVersion = parseExpectedVersion(payload);
  if (!key) {
    res.status(400).json({ ok: false, message: 'state key is required' });
    return;
  }

  const value = Object.prototype.hasOwnProperty.call(payload, 'value') ? payload.value : null;
  const existing = await db.get('SELECT * FROM runtime_state WHERE state_key = ? LIMIT 1', [key]);

  if (existing) {
    if (expectedVersion !== null && Number(existing.version ?? 1) !== expectedVersion) {
      sendVersionConflict(res, 'runtime state version conflict', mapRuntimeStateRow(existing));
      return;
    }
    await db.run(
      `
        UPDATE runtime_state
        SET state_json = ?,
            version = version + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE state_key = ?
      `,
      [JSON.stringify(value), key],
    );
  } else {
    if (expectedVersion !== null && expectedVersion !== 0) {
      sendVersionConflict(res, 'runtime state version conflict');
      return;
    }
    await db.run(
      `
        INSERT INTO runtime_state (state_key, state_json, version)
        VALUES (?, ?, 1)
      `,
      [key, JSON.stringify(value)],
    );
  }

  const row = await db.get('SELECT * FROM runtime_state WHERE state_key = ? LIMIT 1', [key]);
  res.json({ ok: true, item: row ? mapRuntimeStateRow(row) : null });
}));

app.get('/api/claims', withDb(async (db, _req, res) => {
  const rows = await db.all('SELECT * FROM claims ORDER BY updated_at DESC, created_at DESC');
  res.json({ ok: true, items: rows.map(mapClaimRow) });
}));

app.put('/api/claims', withDb(async (db, req, res) => {
  const payload = req.body ?? {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  const replaceMissing = payload.replaceMissing === true;

  for (const [index, item] of items.entries()) {
    const id = String(item?.id || `CLM-${Date.now()}-${index}`).trim();
    if (!id) continue;
    await db.run(
      `
        INSERT INTO claims (
          id, title, amount, reason, content, receipt_name, receipt_preview, receipt_type,
          receipts_json, payout_at, applicant, applicant_role, reviewer, reviewed_at, status,
          return_reason, payout_completed_at, payout_completed_by, history_json, created_label, updated_label
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          title = VALUES(title),
          amount = VALUES(amount),
          reason = VALUES(reason),
          content = VALUES(content),
          receipt_name = VALUES(receipt_name),
          receipt_preview = VALUES(receipt_preview),
          receipt_type = VALUES(receipt_type),
          receipts_json = VALUES(receipts_json),
          payout_at = VALUES(payout_at),
          applicant = VALUES(applicant),
          applicant_role = VALUES(applicant_role),
          reviewer = VALUES(reviewer),
          reviewed_at = VALUES(reviewed_at),
          status = VALUES(status),
          return_reason = VALUES(return_reason),
          payout_completed_at = VALUES(payout_completed_at),
          payout_completed_by = VALUES(payout_completed_by),
          history_json = VALUES(history_json),
          created_label = VALUES(created_label),
          updated_label = VALUES(updated_label),
          version = claims.version + 1,
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        id,
        String(item?.title || ''),
        Number(item?.amount || 0),
        String(item?.reason || ''),
        String(item?.content || ''),
        String(item?.receiptName || ''),
        String(item?.receiptPreview || ''),
        String(item?.receiptType || ''),
        claimsJson(item?.receipts),
        String(item?.payoutAt || ''),
        String(item?.applicant || ''),
        String(item?.applicantRole || ''),
        String(item?.reviewer || ''),
        String(item?.reviewedAt || ''),
        String(item?.status || 'pending'),
        String(item?.returnReason || ''),
        String(item?.payoutCompletedAt || ''),
        String(item?.payoutCompletedBy || ''),
        claimsJson(item?.history),
        String(item?.createdAt || ''),
        String(item?.updatedAt || ''),
      ],
    );
  }

  if (replaceMissing) {
    const ids = items.map((item) => String(item?.id || '').trim()).filter(Boolean);
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(', ');
      await db.run(`DELETE FROM claims WHERE id NOT IN (${placeholders})`, ids);
    } else {
      await db.run('DELETE FROM claims');
    }
  }

  const rows = await db.all('SELECT * FROM claims ORDER BY updated_at DESC, created_at DESC');
  broadcastRealtimeEvent('shihyi_claim_requests_v1', { scope: 'claims', action: replaceMissing ? 'replace' : 'batch-update' });
  res.json({ ok: true, items: rows.map(mapClaimRow) });
}));

app.get('/api/payouts', withDb(async (db, _req, res) => {
  const rows = await db.all('SELECT * FROM payouts ORDER BY updated_at DESC, created_at DESC');
  res.json({ ok: true, items: rows.map(mapPayoutRow) });
}));

app.put('/api/payouts', withDb(async (db, req, res) => {
  const payload = req.body ?? {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  const replaceMissing = payload.replaceMissing === true;

  for (const [index, item] of items.entries()) {
    const id = String(item?.id || `PY-${Date.now()}-${index}`).trim();
    if (!id) continue;
    await db.run(
      `
        INSERT INTO payouts (
          id, title, amount, applicant, deadline, detail, status, proof, proof_preview,
          proof_type, proofs_json, return_reason, completed_at, completed_by, history_json,
          source_type, source_id, created_label, updated_label
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          title = VALUES(title),
          amount = VALUES(amount),
          applicant = VALUES(applicant),
          deadline = VALUES(deadline),
          detail = VALUES(detail),
          status = VALUES(status),
          proof = VALUES(proof),
          proof_preview = VALUES(proof_preview),
          proof_type = VALUES(proof_type),
          proofs_json = VALUES(proofs_json),
          return_reason = VALUES(return_reason),
          completed_at = VALUES(completed_at),
          completed_by = VALUES(completed_by),
          history_json = VALUES(history_json),
          source_type = VALUES(source_type),
          source_id = VALUES(source_id),
          created_label = VALUES(created_label),
          updated_label = VALUES(updated_label),
          version = payouts.version + 1,
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        id,
        String(item?.title || ''),
        Number(item?.amount || 0),
        String(item?.applicant || ''),
        String(item?.deadline || ''),
        String(item?.detail || ''),
        String(item?.status || 'pending'),
        String(item?.proof || ''),
        String(item?.proofPreview || ''),
        String(item?.proofType || ''),
        payoutsJson(item?.proofs),
        String(item?.returnReason || ''),
        String(item?.completedAt || ''),
        String(item?.completedBy || ''),
        payoutsJson(item?.history),
        String(item?.sourceType || ''),
        String(item?.sourceId || ''),
        String(item?.createdAt || ''),
        String(item?.updatedAt || ''),
      ],
    );
  }

  if (replaceMissing) {
    const ids = items.map((item) => String(item?.id || '').trim()).filter(Boolean);
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(', ');
      await db.run(`DELETE FROM payouts WHERE id NOT IN (${placeholders})`, ids);
    } else {
      await db.run('DELETE FROM payouts');
    }
  }

  const rows = await db.all('SELECT * FROM payouts ORDER BY updated_at DESC, created_at DESC');
  broadcastRealtimeEvent('shihyi_payouts', { scope: 'payouts', action: replaceMissing ? 'replace' : 'batch-update' });
  res.json({ ok: true, items: rows.map(mapPayoutRow) });
}));

app.post('/api/auth/login', withDb(async (db, req, res) => {
  const payload = req.body ?? {};
  const account = String(payload.account || '').trim();
  const password = String(payload.password || '');

  if (!account || !password) {
    res.status(400).json({ ok: false, message: 'account and password are required' });
    return;
  }

  await ensureDefaultAuthUsers(db);

  const row = await db.get('SELECT * FROM auth_users WHERE account = ? LIMIT 1', [account]);
  if (!row || !verifyAuthPassword(password, row.password)) {
    res.status(401).json({ ok: false, message: 'invalid account or password' });
    return;
  }
  if (Number(row.active ?? 1) === 0) {
    res.status(403).json({ ok: false, message: 'account disabled' });
    return;
  }
  if (!isHashedAuthPassword(row.password)) {
    const upgradedPassword = hashAuthPassword(password);
    await db.run(
      `
        UPDATE auth_users
        SET password = ?,
            version = version + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [upgradedPassword, row.id],
    );
    row.password = upgradedPassword;
  }

  res.json({ ok: true, user: mapAuthUserRow(row) });
}));

app.get('/api/customers', withDb(async (db, _req, res) => {
  const rows = await db.all('SELECT * FROM customers ORDER BY id DESC');
  res.json({ ok: true, items: rows.map(mapCustomerRow) });
}));

app.post('/api/customers', withDb(async (db, req, res) => {
  const payload = req.body ?? {};

  if (!payload.company || !payload.contact) {
    res.status(400).json({ ok: false, message: 'company and contact are required' });
    return;
  }

  const result = await db.run(
    `
      INSERT INTO customers (company, contact, phone, email, tax_id, address, owner, note, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      payload.company,
      payload.contact,
      payload.phone ?? '',
      payload.email ?? '',
      payload.taxId ?? '',
      payload.address ?? '',
      payload.owner ?? '',
      payload.note ?? '',
      payload.status ?? 'active',
    ],
  );

  const row = await db.get('SELECT * FROM customers WHERE id = ?', [result.insertId]);
  broadcastRealtimeEvent('customers', { scope: 'customers', action: 'created', id: row?.id ?? result.insertId });
  res.status(201).json({ ok: true, item: mapCustomerRow(row) });
}));

app.put('/api/customers/:id', withDb(async (db, req, res) => {
  const id = Number(req.params.id);
  const payload = req.body ?? {};
  const expectedVersion = parseExpectedVersion(payload);
  const exists = await db.get('SELECT id FROM customers WHERE id = ?', [id]);

  if (!exists) {
    res.status(404).json({ ok: false, message: 'customer not found' });
    return;
  }
  const existing = await db.get('SELECT * FROM customers WHERE id = ?', [id]);
  if (expectedVersion !== null && Number(existing?.version ?? 1) !== expectedVersion) {
    sendVersionConflict(res, 'customer version conflict', existing ? mapCustomerRow(existing) : null);
    return;
  }

  await db.run(
    `
      UPDATE customers
      SET company = COALESCE(?, company),
          contact = COALESCE(?, contact),
          phone = COALESCE(?, phone),
          email = COALESCE(?, email),
          tax_id = COALESCE(?, tax_id),
          address = COALESCE(?, address),
          owner = COALESCE(?, owner),
          note = COALESCE(?, note),
          status = COALESCE(?, status),
          version = version + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [
      payload.company ?? null,
      payload.contact ?? null,
      payload.phone ?? null,
      payload.email ?? null,
      payload.taxId ?? null,
      payload.address ?? null,
      payload.owner ?? null,
      payload.note ?? null,
      payload.status ?? null,
      id,
    ],
  );

  const row = await db.get('SELECT * FROM customers WHERE id = ?', [id]);
  broadcastRealtimeEvent('customers', { scope: 'customers', action: 'updated', id });
  res.json({ ok: true, item: mapCustomerRow(row) });
}));

app.delete('/api/customers/:id', withDb(async (db, req, res) => {
  const id = Number(req.params.id);
  const payload = req.body ?? {};
  const expectedVersion = parseExpectedVersion(payload);
  const exists = await db.get('SELECT * FROM customers WHERE id = ?', [id]);

  if (!exists) {
    res.status(404).json({ ok: false, message: 'customer not found' });
    return;
  }
  if (expectedVersion !== null && Number(exists.version ?? 1) !== expectedVersion) {
    sendVersionConflict(res, 'customer version conflict', mapCustomerRow(exists));
    return;
  }

  const relatedQuote = await db.get('SELECT id FROM quotes WHERE customer_id = ? LIMIT 1', [id]);
  if (relatedQuote) {
    res.status(409).json({ ok: false, message: 'customer has related quotes' });
    return;
  }

  await db.run('DELETE FROM customers WHERE id = ?', [id]);
  broadcastRealtimeEvent('customers', { scope: 'customers', action: 'deleted', id });
  res.json({ ok: true });
}));

app.get('/api/quotes', withDb(async (db, _req, res) => {
  const rows = await db.all(`${quoteSelect} ORDER BY q.id DESC`);
  res.json({ ok: true, items: rows.map(mapQuoteRow) });
}));

app.get('/api/quotes/:id', withDb(async (db, req, res) => {
  const row = await db.get(`${quoteSelect} WHERE q.id = ?`, [Number(req.params.id)]);

  if (!row) {
    res.status(404).json({ ok: false, message: 'quote not found' });
    return;
  }

  res.json({ ok: true, item: mapQuoteRow(row) });
}));

app.post('/api/quotes', withDb(async (db, req, res) => {
  const payload = req.body ?? {};

  if (!payload.customerId || !payload.customerName || !payload.project) {
    res.status(400).json({ ok: false, message: 'customerId, customerName and project are required' });
    return;
  }

  const result = await db.run(
    `
      INSERT INTO quotes (
        number, customer_id, customer_name, contact, owner, project, status,
        quote_date, valid_until, event_date, tax_rate, discount, note,
        items_json, attachments_json, history_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      payload.number,
      payload.customerId,
      payload.customerName,
      payload.contact ?? '',
      payload.owner ?? '',
      payload.project,
      payload.status ?? 'draft',
      payload.quoteDate ?? '',
      payload.validUntil ?? '',
      payload.eventDate ?? '',
      payload.taxRate ?? 0.05,
      payload.discount ?? 0,
      payload.note ?? '',
      JSON.stringify(payload.items ?? []),
      JSON.stringify(payload.attachments ?? []),
      JSON.stringify(payload.history ?? []),
    ],
  );

  await saveQuoteHistory(
    db,
    result.insertId,
    payload.action ?? 'created',
    payload.note ?? '',
    payload.owner ?? 'system',
  );

  const row = await db.get(`${quoteSelect} WHERE q.id = ?`, [result.insertId]);
  broadcastRealtimeEvent('quotes', { scope: 'quotes', action: 'created', id: row?.id ?? result.insertId });
  res.status(201).json({ ok: true, item: mapQuoteRow(row) });
}));

app.put('/api/quotes/:id', withDb(async (db, req, res) => {
  const id = Number(req.params.id);
  const payload = req.body ?? {};
  const expectedVersion = parseExpectedVersion(payload);
  const exists = await db.get('SELECT * FROM quotes WHERE id = ?', [id]);

  if (!exists) {
    res.status(404).json({ ok: false, message: 'quote not found' });
    return;
  }
  if (expectedVersion !== null && Number(exists.version ?? 1) !== expectedVersion) {
    const latest = await db.get(`${quoteSelect} WHERE q.id = ?`, [id]);
    sendVersionConflict(res, 'quote version conflict', latest ? mapQuoteRow(latest) : null);
    return;
  }

  await db.run(
    `
      UPDATE quotes
      SET customer_id = COALESCE(?, customer_id),
          customer_name = COALESCE(?, customer_name),
          contact = COALESCE(?, contact),
          owner = COALESCE(?, owner),
          project = COALESCE(?, project),
          status = COALESCE(?, status),
          quote_date = COALESCE(?, quote_date),
          valid_until = COALESCE(?, valid_until),
          event_date = COALESCE(?, event_date),
          tax_rate = COALESCE(?, tax_rate),
          discount = COALESCE(?, discount),
          note = COALESCE(?, note),
          items_json = COALESCE(?, items_json),
          attachments_json = COALESCE(?, attachments_json),
          history_json = COALESCE(?, history_json),
          version = version + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [
      payload.customerId ?? null,
      payload.customerName ?? null,
      payload.contact ?? null,
      payload.owner ?? null,
      payload.project ?? null,
      payload.status ?? null,
      payload.quoteDate ?? null,
      payload.validUntil ?? null,
      payload.eventDate ?? null,
      payload.taxRate ?? null,
      payload.discount ?? null,
      payload.note ?? null,
      payload.items ? JSON.stringify(payload.items) : null,
      payload.attachments ? JSON.stringify(payload.attachments) : null,
      payload.history ? JSON.stringify(payload.history) : null,
      id,
    ],
  );

  await saveQuoteHistory(
    db,
    id,
    payload.action ?? 'updated',
    payload.note ?? '',
    payload.actor ?? 'system',
  );

  const row = await db.get(`${quoteSelect} WHERE q.id = ?`, [id]);
  broadcastRealtimeEvent('quotes', { scope: 'quotes', action: 'updated', id });
  res.json({ ok: true, item: mapQuoteRow(row) });
}));

app.delete('/api/quotes/:id', withDb(async (db, req, res) => {
  const id = Number(req.params.id);
  const exists = await db.get('SELECT id FROM quotes WHERE id = ?', [id]);

  if (!exists) {
    res.status(404).json({ ok: false, message: 'quote not found' });
    return;
  }

  await db.run('DELETE FROM quotes WHERE id = ?', [id]);
  broadcastRealtimeEvent('quotes', { scope: 'quotes', action: 'deleted', id });
  res.json({ ok: true, deletedId: id });
}));

app.get('/api/quotes/:id/history', withDb(async (db, req, res) => {
  const rows = await db.all(
    'SELECT * FROM quote_history WHERE quote_id = ? ORDER BY id DESC',
    [Number(req.params.id)],
  );

  res.json({
    ok: true,
    items: rows.map((row) => ({
      id: row.id,
      quoteId: row.quote_id,
      action: row.action,
      note: row.note ?? '',
      actor: row.actor ?? '',
      createdAt: row.created_at,
    })),
  });
}));

app.post('/api/uploads/test', upload.single('file'), (req, res) => {
  res.json({
    ok: true,
    file: req.file ?? null,
  });
});

export default app;

