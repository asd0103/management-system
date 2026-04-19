import mysql from 'mysql2/promise';

const readEnv = (...keys) => {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return '';
};

const config = {
  host: readEnv('SHIYI_DB_HOST', 'MYSQL_HOST'),
  port: Number(readEnv('SHIYI_DB_PORT', 'MYSQL_PORT') || 3306),
  user: readEnv('SHIYI_DB_USER', 'MYSQL_USER'),
  password: readEnv('SHIYI_DB_PASSWORD', 'MYSQL_PASSWORD'),
  database: readEnv('SHIYI_DB_NAME', 'MYSQL_DATABASE'),
};

const missing = Object.entries({
  SHIYI_DB_HOST: config.host,
  SHIYI_DB_USER: config.user,
  SHIYI_DB_PASSWORD: config.password,
  SHIYI_DB_NAME: config.database,
}).filter(([, value]) => !value).map(([key]) => key);

if (missing.length > 0) {
  throw new Error(`Missing database env vars: ${missing.join(', ')}`);
}

const pool = mysql.createPool({
  host: config.host,
  port: config.port,
  user: config.user,
  password: config.password,
  database: config.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  decimalNumbers: true,
});

const schemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE,
      role VARCHAR(100) NOT NULL DEFAULT 'employee',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `,
  `
    CREATE TABLE IF NOT EXISTS customers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company VARCHAR(255) NOT NULL,
      contact VARCHAR(255) NOT NULL,
      phone VARCHAR(255) NULL,
      email VARCHAR(255) NULL,
      tax_id VARCHAR(255) NULL,
      address TEXT NULL,
      owner VARCHAR(255) NULL,
      note TEXT NULL,
      status VARCHAR(100) NOT NULL DEFAULT 'active',
      version INT NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `,
  `
    CREATE TABLE IF NOT EXISTS quotes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      number VARCHAR(255) NOT NULL UNIQUE,
      customer_id INT NOT NULL,
      customer_name VARCHAR(255) NOT NULL,
      contact VARCHAR(255) NOT NULL,
      owner VARCHAR(255) NOT NULL,
      project VARCHAR(255) NOT NULL,
      status VARCHAR(100) NOT NULL DEFAULT 'draft',
      quote_date VARCHAR(50) NULL,
      valid_until VARCHAR(50) NULL,
      event_date VARCHAR(50) NULL,
      tax_rate DECIMAL(10,4) NOT NULL DEFAULT 0.0500,
      discount INT NOT NULL DEFAULT 0,
      note TEXT NULL,
      items_json LONGTEXT NOT NULL,
      attachments_json LONGTEXT NOT NULL,
      history_json LONGTEXT NOT NULL,
      version INT NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_quotes_customer
        FOREIGN KEY (customer_id) REFERENCES customers(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `,
  `
    CREATE TABLE IF NOT EXISTS quote_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      quote_id INT NOT NULL,
      action VARCHAR(255) NOT NULL,
      note TEXT NULL,
      actor VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_quote_history_quote
        FOREIGN KEY (quote_id) REFERENCES quotes(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `,
  `
    CREATE TABLE IF NOT EXISTS auth_users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      account VARCHAR(255) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(100) NOT NULL DEFAULT '?∪極',
      department VARCHAR(255) NOT NULL DEFAULT '',
      active TINYINT(1) NOT NULL DEFAULT 1,
      history_json LONGTEXT NOT NULL DEFAULT '[]',
      version INT NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `,
  `
    CREATE TABLE IF NOT EXISTS claims (
      id VARCHAR(255) PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      amount INT NOT NULL DEFAULT 0,
      reason TEXT NULL,
      content LONGTEXT NULL,
      receipt_name VARCHAR(255) NULL,
      receipt_preview LONGTEXT NULL,
      receipt_type VARCHAR(255) NULL,
      receipts_json LONGTEXT NOT NULL,
      payout_at VARCHAR(50) NULL,
      applicant VARCHAR(255) NULL,
      applicant_role VARCHAR(100) NULL,
      reviewer VARCHAR(255) NULL,
      reviewed_at VARCHAR(50) NULL,
      status VARCHAR(100) NOT NULL DEFAULT 'pending',
      return_reason TEXT NULL,
      payout_completed_at VARCHAR(50) NULL,
      payout_completed_by VARCHAR(255) NULL,
      history_json LONGTEXT NOT NULL,
      version INT NOT NULL DEFAULT 1,
      created_label VARCHAR(50) NULL,
      updated_label VARCHAR(50) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `,
  `
    CREATE TABLE IF NOT EXISTS payouts (
      id VARCHAR(255) PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      amount INT NOT NULL DEFAULT 0,
      applicant VARCHAR(255) NULL,
      deadline VARCHAR(50) NULL,
      detail LONGTEXT NULL,
      status VARCHAR(100) NOT NULL DEFAULT 'pending',
      proof VARCHAR(255) NULL,
      proof_preview LONGTEXT NULL,
      proof_type VARCHAR(255) NULL,
      proofs_json LONGTEXT NOT NULL,
      return_reason TEXT NULL,
      completed_at VARCHAR(50) NULL,
      completed_by VARCHAR(255) NULL,
      history_json LONGTEXT NOT NULL,
      source_type VARCHAR(50) NULL,
      source_id VARCHAR(255) NULL,
      version INT NOT NULL DEFAULT 1,
      created_label VARCHAR(50) NULL,
      updated_label VARCHAR(50) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `,
  `
    CREATE TABLE IF NOT EXISTS runtime_state (
      id INT AUTO_INCREMENT PRIMARY KEY,
      state_key VARCHAR(255) NOT NULL UNIQUE,
      state_json LONGTEXT NOT NULL,
      version INT NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `,
];

const authUserSeed = { name: 'Allen', account: 'asd', password: '000', role: '\u7ba1\u7406\u8005', department: '\u71df\u904b\u7ba1\u7406', active: 1 };
const legacyAuthAccounts = ['amber', 'victor', 'mia', 'kevin'];
const ensureSchema = async () => {
  const connection = await pool.getConnection();

  try {
    for (const statement of schemaStatements) {
      await connection.query(statement);
    }
  } finally {
    connection.release();
  }
};

await ensureSchema();

const ensureAuthUserHistoryColumn = async () => {
  const connection = await pool.getConnection();

  try {
    const [rows] = await connection.query(
      `
        SELECT COUNT(*) AS count
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'auth_users'
          AND COLUMN_NAME = 'history_json'
      `,
    );

    if (Number(rows?.[0]?.count || 0) === 0) {
      await connection.query(
        `
          ALTER TABLE auth_users
          ADD COLUMN history_json LONGTEXT NOT NULL DEFAULT '[]'
        `,
      );
    }
  } finally {
    connection.release();
  }
};

await ensureAuthUserHistoryColumn();

const ensureVersionColumn = async (tableName) => {
  const connection = await pool.getConnection();

  try {
    const [rows] = await connection.query(
      `
        SELECT COUNT(*) AS count
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = 'version'
      `,
      [tableName],
    );

    if (Number(rows?.[0]?.count || 0) === 0) {
      await connection.query(
        `
          ALTER TABLE ?? 
          ADD COLUMN version INT NOT NULL DEFAULT 1
        `,
        [tableName],
      );
    }
  } finally {
    connection.release();
  }
};

await ensureVersionColumn('auth_users');
await ensureVersionColumn('customers');
await ensureVersionColumn('quotes');
await ensureVersionColumn('claims');
await ensureVersionColumn('payouts');
await ensureVersionColumn('runtime_state');

const ensureAuthUsers = async () => {
  const connection = await pool.getConnection();

  try {
    if (legacyAuthAccounts.length > 0) {
      await connection.query(
        `DELETE FROM auth_users WHERE account IN (?, ?, ?, ?)`,
        legacyAuthAccounts,
      );
    }

    await connection.query(
      `
        INSERT INTO auth_users (name, account, password, role, department, active, history_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          password = VALUES(password),
          role = VALUES(role),
          department = VALUES(department),
          active = VALUES(active)
      `,
      [
        authUserSeed.name,
        authUserSeed.account,
        authUserSeed.password,
        authUserSeed.role,
        authUserSeed.department,
        authUserSeed.active,
        '[]',
      ],
    );
  } finally {
    connection.release();
  }
};

await ensureAuthUsers();
const db = {
  async get(sql, params = []) {
    const [rows] = await pool.execute(sql, params);
    return rows[0] ?? null;
  },
  async all(sql, params = []) {
    const [rows] = await pool.execute(sql, params);
    return rows;
  },
  async run(sql, params = []) {
    const [result] = await pool.execute(sql, params);
    return result;
  },
  async close() {
    await pool.end();
  },
};

export default db;

