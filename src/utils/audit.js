const db = require('../config/database');

const auditLog = (action, module, userId, topicId, details, ipAddress) => {
  return new Promise((resolve, reject) => {
    const detailsStr = typeof details === 'object' ? JSON.stringify(details) : details;
    db.run(
      `INSERT INTO audit_logs (action, module, user_id, topic_id, ip_address, details) VALUES (?, ?, ?, ?, ?, ?)`,
      [action, module, userId || null, topicId || null, ipAddress || null, detailsStr || null],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
};

module.exports = { auditLog };
