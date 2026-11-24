// Migration: leave_requests (2026-10-13)
//
// The department leave-requests subsystem (spec:
// docs/superpowers/specs/2026-10-13-leave-requests-design.md §3).
// New table + three indexes; column-guarded CREATE IF NOT EXISTS like the
// existing migrations. The status CHECK vocabulary ('Pending','Approved',
// 'Denied') is contract-tested against LEAVE_STATUSES by
// scripts/testLeaveContract.js (repo convention: testConversationTypeContract).

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  submitted_by INTEGER,
  dept_id INTEGER,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Approved','Denied')),
  decision_note TEXT,
  decided_by INTEGER,
  decided_at DATETIME,
  attachments TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(submitted_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(dept_id) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY(decided_by) REFERENCES users(id) ON DELETE SET NULL
)`;

const INDEX_SQL = [
  'CREATE INDEX IF NOT EXISTS idx_leave_requests_dept_status ON leave_requests(dept_id, status)',
  'CREATE INDEX IF NOT EXISTS idx_leave_requests_user_status ON leave_requests(user_id, status)',
  'CREATE INDEX IF NOT EXISTS idx_leave_requests_created ON leave_requests(created_at DESC)',
];

export async function up(db) {
  await db.exec(TABLE_SQL);
  for (const sql of INDEX_SQL) await db.exec(sql);
}

export async function down(db) {
  await db.exec('DROP INDEX IF EXISTS idx_leave_requests_dept_status');
  await db.exec('DROP INDEX IF EXISTS idx_leave_requests_user_status');
  await db.exec('DROP INDEX IF EXISTS idx_leave_requests_created');
  await db.exec('DROP TABLE IF EXISTS leave_requests');
}
