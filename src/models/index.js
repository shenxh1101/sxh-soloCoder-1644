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
          status TEXT DEFAULT 'pending',
          priority TEXT DEFAULT 'medium',
          due_date DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (resolution_id) REFERENCES resolutions(id),
          FOREIGN KEY (topic_id) REFERENCES topics(id),
          FOREIGN KEY (assignee_department_id) REFERENCES departments(id),
          FOREIGN KEY (assignee_user_id) REFERENCES users(id)
        )
      `);

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
          stat_date DATE NOT NULL UNIQUE,
          department_id INTEGER,
          total_topics INTEGER DEFAULT 0,
          passed_topics INTEGER DEFAULT 0,
          total_voters INTEGER DEFAULT 0,
          participation_rate REAL DEFAULT 0,
          pass_rate REAL DEFAULT 0,
          avg_votes REAL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (department_id) REFERENCES departments(id)
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
      db.run(`CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_statistics(stat_date)`);

      resolve();
    });
  });
};

module.exports = initDatabase;
