const db = require('../config/database');

const initDatabase = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS departments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          manager_id INTEGER,
          parent_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (parent_id) REFERENCES departments(id)
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL,
          real_name TEXT NOT NULL,
          email TEXT,
          department_id INTEGER,
          position TEXT,
          role TEXT NOT NULL DEFAULT 'employee',
          status TEXT DEFAULT 'active',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (department_id) REFERENCES departments(id)
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS topics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          description TEXT,
          submitter_id INTEGER NOT NULL,
          department_id INTEGER,
          vote_rule TEXT NOT NULL DEFAULT 'simple_majority',
          option_count INTEGER NOT NULL,
          deadline DATETIME NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          eligible_departments TEXT,
          eligible_positions TEXT,
          result TEXT,
          resolution_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (submitter_id) REFERENCES users(id),
          FOREIGN KEY (department_id) REFERENCES departments(id)
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS options (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          topic_id INTEGER NOT NULL,
          option_text TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS votes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          topic_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          option_id INTEGER NOT NULL,
          ip_address TEXT,
          voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (topic_id) REFERENCES topics(id),
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (option_id) REFERENCES options(id),
          UNIQUE(topic_id, user_id)
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS resolutions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          topic_id INTEGER NOT NULL UNIQUE,
          result TEXT NOT NULL,
          vote_count INTEGER NOT NULL,
          total_voters INTEGER NOT NULL,
          pass_rate REAL,
          report_content TEXT,
          approved_by INTEGER,
          approved_at DATETIME,
          status TEXT DEFAULT 'pending',
          escalated INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (topic_id) REFERENCES topics(id),
          FOREIGN KEY (approved_by) REFERENCES users(id)
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          resolution_id INTEGER NOT NULL,
          topic_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          assignee_department_id INTEGER NOT NULL,
          assignee_user_id INTEGER,
          current_handler_id INTEGER,
          status TEXT DEFAULT 'assigned',
          priority TEXT DEFAULT 'medium',
          due_date DATETIME,
          received_at DATETIME,
          completed_at DATETIME,
          returned_count INTEGER DEFAULT 0,
          last_remark TEXT,
          last_operation_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (resolution_id) REFERENCES resolutions(id),
          FOREIGN KEY (topic_id) REFERENCES topics(id),
          FOREIGN KEY (assignee_department_id) REFERENCES departments(id),
          FOREIGN KEY (assignee_user_id) REFERENCES users(id),
          FOREIGN KEY (current_handler_id) REFERENCES users(id)
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS task_operation_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id INTEGER NOT NULL,
          operator_id INTEGER NOT NULL,
          action TEXT NOT NULL,
          from_status TEXT,
          to_status TEXT,
          remark TEXT,
          previous_handler_id INTEGER,
          new_handler_id INTEGER,
          ip_address TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
          FOREIGN KEY (operator_id) REFERENCES users(id),
          FOREIGN KEY (previous_handler_id) REFERENCES users(id),
          FOREIGN KEY (new_handler_id) REFERENCES users(id)
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS export_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          export_key TEXT NOT NULL UNIQUE,
          module TEXT NOT NULL,
          format TEXT NOT NULL,
          filter_snapshot TEXT NOT NULL,
          filter_hash TEXT NOT NULL,
          record_count INTEGER NOT NULL DEFAULT 0,
          file_size INTEGER NOT NULL DEFAULT 0,
          content_snapshot BLOB,
          content_filename TEXT,
          content_type TEXT,
          operator_id INTEGER,
          operator_name TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_downloaded_at DATETIME,
          download_count INTEGER DEFAULT 0,
          FOREIGN KEY (operator_id) REFERENCES users(id)
        )
      `);

      db.run(`ALTER TABLE export_records ADD COLUMN content_type TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.log('content_type 列可能已存在，跳过添加');
        }
      });

      db.run(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          action TEXT NOT NULL,
          module TEXT NOT NULL,
          user_id INTEGER,
          topic_id INTEGER,
          ip_address TEXT,
          details TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (topic_id) REFERENCES topics(id)
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS recount_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          topic_id INTEGER NOT NULL,
          operator_id INTEGER NOT NULL,
          reason TEXT,
          before_result TEXT,
          after_result TEXT,
          before_vote_count INTEGER,
          after_vote_count INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (topic_id) REFERENCES topics(id),
          FOREIGN KEY (operator_id) REFERENCES users(id)
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS daily_statistics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          stat_date DATE NOT NULL,
          department_id INTEGER,
          total_topics INTEGER DEFAULT 0,
          passed_topics INTEGER DEFAULT 0,
          total_voters INTEGER DEFAULT 0,
          participation_rate REAL DEFAULT 0,
          pass_rate REAL DEFAULT 0,
          avg_votes REAL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (department_id) REFERENCES departments(id),
          UNIQUE(stat_date, department_id)
        )
      `);

      db.run(`CREATE INDEX IF NOT EXISTS idx_votes_topic ON votes(topic_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_votes_user ON votes(user_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_topics_status ON topics(status)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_topics_deadline ON topics(deadline)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_audit_logs_topic ON audit_logs(topic_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_department ON tasks(assignee_department_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_handler ON tasks(current_handler_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_task_ops_task ON task_operation_logs(task_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_task_ops_created ON task_operation_logs(created_at)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_export_key ON export_records(export_key)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_export_hash ON export_records(filter_hash)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_export_module ON export_records(module)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_statistics(stat_date)`);

      resolve();
    });
  });
};

module.exports = initDatabase;
