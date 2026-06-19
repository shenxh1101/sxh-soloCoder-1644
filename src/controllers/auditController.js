const db = require('../config/database');
const dayjs = require('dayjs');

const getAuditLogs = (req, res) => {
  const {
    page = 1,
    page_size = 20,
    topic_id,
    user_id,
    action,
    module,
    start_date,
    end_date,
    keyword,
  } = req.query;

  const offset = (page - 1) * page_size;

  let whereClause = 'WHERE 1=1';
  const params = [];

  if (topic_id) {
    whereClause += ' AND l.topic_id = ?';
    params.push(topic_id);
  }
  if (user_id) {
    whereClause += ' AND l.user_id = ?';
    params.push(user_id);
  }
  if (action) {
    whereClause += ' AND l.action = ?';
    params.push(action);
  }
  if (module) {
    whereClause += ' AND l.module = ?';
    params.push(module);
  }
  if (start_date) {
    whereClause += ' AND l.created_at >= ?';
    params.push(start_date);
  }
  if (end_date) {
    whereClause += ' AND l.created_at <= ?';
    params.push(end_date);
  }
  if (keyword) {
    whereClause += ' AND (l.details LIKE ? OR l.action LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const countSql = `SELECT COUNT(*) as total FROM audit_logs l ${whereClause}`;
  const listSql = `
    SELECT l.*, 
           u.real_name as user_name,
           u.username,
           t.title as topic_title
    FROM audit_logs l
    LEFT JOIN users u ON l.user_id = u.id
    LEFT JOIN topics t ON l.topic_id = t.id
    ${whereClause}
    ORDER BY l.created_at DESC
    LIMIT ? OFFSET ?
  `;

  db.get(countSql, params, (err, countResult) => {
    if (err) return res.status(500).json({ error: '数据库错误' });

    db.all(listSql, [...params, parseInt(page_size), offset], (err, logs) => {
      if (err) return res.status(500).json({ error: '数据库错误' });

      res.json({
        list: logs,
        total: countResult.total,
        page: parseInt(page),
        page_size: parseInt(page_size),
      });
    });
  });
};

const exportAuditLogs = (req, res) => {
  const { topic_id, user_id, action, module, start_date, end_date, keyword, format = 'json' } = req.query;

  let whereClause = 'WHERE 1=1';
  const params = [];

  if (topic_id) {
    whereClause += ' AND l.topic_id = ?';
    params.push(topic_id);
  }
  if (user_id) {
    whereClause += ' AND l.user_id = ?';
    params.push(user_id);
  }
  if (action) {
    whereClause += ' AND l.action = ?';
    params.push(action);
  }
  if (module) {
    whereClause += ' AND l.module = ?';
    params.push(module);
  }
  if (start_date) {
    whereClause += ' AND l.created_at >= ?';
    params.push(start_date);
  }
  if (end_date) {
    whereClause += ' AND l.created_at <= ?';
    params.push(end_date);
  }
  if (keyword) {
    whereClause += ' AND (l.details LIKE ? OR l.action LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const sql = `
    SELECT l.*, 
           u.real_name as user_name,
           u.username,
           t.title as topic_title
    FROM audit_logs l
    LEFT JOIN users u ON l.user_id = u.id
    LEFT JOIN topics t ON l.topic_id = t.id
    ${whereClause}
    ORDER BY l.created_at DESC
  `;

  db.all(sql, params, (err, logs) => {
    if (err) return res.status(500).json({ error: '导出失败' });

    if (format === 'csv') {
      const headers = ['ID', '操作', '模块', '用户', '议题', 'IP地址', '详情', '时间'];
      const csvContent = [
        headers.join(','),
        ...logs.map((log) =>
          [
            log.id,
            log.action,
            log.module,
            log.user_name || '',
            log.topic_title || '',
            log.ip_address || '',
            `"${(log.details || '').replace(/"/g, '""')}"`,
            log.created_at,
          ].join(',')
        ),
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="audit_logs_${dayjs().format('YYYYMMDD')}.csv"`);
      res.send('\uFEFF' + csvContent);
    } else {
      res.json({
        total: logs.length,
        data: logs,
        exported_at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      });
    }
  });
};

module.exports = { getAuditLogs, exportAuditLogs };
