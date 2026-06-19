const db = require('../config/database');
const { auditLog } = require('../utils/audit');
const dayjs = require('dayjs');

const validateTopic = (topic) => {
  const errors = [];

  if (!topic.title || topic.title.trim().length < 2) {
    errors.push('议题标题至少2个字符');
  }
  if (topic.title && topic.title.length > 200) {
    errors.push('议题标题不能超过200个字符');
  }
  if (!topic.options || !Array.isArray(topic.options) || topic.options.length < 2) {
    errors.push('至少需要2个投票选项');
  }
  if (topic.options && topic.options.length > 10) {
    errors.push('最多支持10个投票选项');
  }
  if (!topic.deadline) {
    errors.push('截止时间是必填项');
  } else if (new Date(topic.deadline) <= new Date()) {
    errors.push('截止时间必须晚于当前时间');
  }
  if (topic.vote_rule && !['simple_majority', 'absolute_majority'].includes(topic.vote_rule)) {
    errors.push('无效的投票规则');
  }
  if (topic.options) {
    const invalidOpts = topic.options.filter(opt => !opt || opt.trim().length === 0);
    if (invalidOpts.length > 0) {
      errors.push('存在空的投票选项');
    }
  }

  return errors;
};

const createTopic = async (req, res) => {
  const { title, description, department_id, vote_rule, options, deadline, eligible_departments, eligible_positions } = req.body;

  const errors = validateTopic({ title, options, deadline, vote_rule });
  if (errors.length > 0) {
    return res.status(400).json({ error: '议题格式不合规', details: errors });
  }

  const deptId = department_id || req.user.department_id;

  db.serialize(() => {
    const stmt = db.prepare(
      `INSERT INTO topics (title, description, submitter_id, department_id, vote_rule, option_count, deadline, eligible_departments, eligible_positions, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    );

    stmt.run(
      title.trim(),
      description || null,
      req.user.id,
      deptId,
      vote_rule || 'simple_majority',
      options.length,
      deadline,
      eligible_departments ? JSON.stringify(eligible_departments) : null,
      eligible_positions ? JSON.stringify(eligible_positions) : null,
      async function (err) {
        if (err) {
          return res.status(500).json({ error: '创建议题失败' });
        }

        const topicId = this.lastID;
        const optionStmt = db.prepare(`INSERT INTO options (topic_id, option_text, sort_order) VALUES (?, ?, ?)`);

        options.forEach((opt, index) => {
          optionStmt.run(topicId, opt.trim(), index);
        });
        optionStmt.finalize();

        await auditLog('create_topic', 'topic', req.user.id, topicId, { title, options_count: options.length }, req.ip);

        res.status(201).json({
          id: topicId,
          title,
          status: 'pending',
          message: '议题提交成功，已进入待审核状态',
        });
      }
    );
    stmt.finalize();
  });
};

const getTopicList = (req, res) => {
  const { page = 1, page_size = 20, status, department_id, keyword, start_date, end_date } = req.query;
  const offset = (page - 1) * page_size;

  let whereClause = 'WHERE 1=1';
  const params = [];

  if (req.user.role === 'employee') {
    whereClause += ` AND (
      t.status = 'voting' 
      OR t.status = 'completed'
      OR t.status = 'resolved'
      OR t.submitter_id = ?
    )`;
    params.push(req.user.id);
  } else if (req.user.role === 'manager') {
    whereClause += ' AND t.department_id = ?';
    params.push(req.user.department_id);
  }

  if (status) {
    whereClause += ' AND t.status = ?';
    params.push(status);
  }
  if (department_id && req.user.role === 'admin') {
    whereClause += ' AND t.department_id = ?';
    params.push(department_id);
  }
  if (keyword) {
    whereClause += ' AND t.title LIKE ?';
    params.push(`%${keyword}%`);
  }
  if (start_date) {
    whereClause += ' AND t.created_at >= ?';
    params.push(start_date);
  }
  if (end_date) {
    whereClause += ' AND t.created_at <= ?';
    params.push(end_date);
  }

  const countSql = `SELECT COUNT(*) as total FROM topics t ${whereClause}`;
  const listSql = `
    SELECT t.*, 
           u.real_name as submitter_name,
           d.name as department_name,
           (SELECT COUNT(*) FROM votes v WHERE v.topic_id = t.id) as vote_count
    FROM topics t
    LEFT JOIN users u ON t.submitter_id = u.id
    LEFT JOIN departments d ON t.department_id = d.id
    ${whereClause}
    ORDER BY t.created_at DESC
    LIMIT ? OFFSET ?
  `;

  db.get(countSql, params, (err, countResult) => {
    if (err) return res.status(500).json({ error: '数据库错误' });

    db.all(listSql, [...params, parseInt(page_size), offset], (err, topics) => {
      if (err) return res.status(500).json({ error: '数据库错误' });

      res.json({
        list: topics,
        total: countResult.total,
        page: parseInt(page),
        page_size: parseInt(page_size),
      });
    });
  });
};

const getTopicDetail = (req, res) => {
  const { id } = req.params;

  db.get(
    `SELECT t.*, 
            u.real_name as submitter_name,
            d.name as department_name
     FROM topics t
     LEFT JOIN users u ON t.submitter_id = u.id
     LEFT JOIN departments d ON t.department_id = d.id
     WHERE t.id = ?`,
    [id],
    (err, topic) => {
      if (err) return res.status(500).json({ error: '数据库错误' });
      if (!topic) return res.status(404).json({ error: '议题不存在' });

      if (req.user.role === 'employee' && 
          topic.status === 'pending' && 
          topic.submitter_id !== req.user.id) {
        return res.status(403).json({ error: '无权查看此议题' });
      }

      if (req.user.role === 'manager' && 
          topic.department_id !== req.user.department_id &&
          req.user.role !== 'admin') {
        return res.status(403).json({ error: '无权查看此议题' });
      }

      db.all(
        `SELECT o.*, 
                (SELECT COUNT(*) FROM votes v WHERE v.option_id = o.id) as vote_count
         FROM options o 
         WHERE o.topic_id = ? 
         ORDER BY o.sort_order ASC`,
        [id],
        (err, options) => {
          if (err) return res.status(500).json({ error: '数据库错误' });

          db.get(
            `SELECT voted FROM (SELECT 1 as voted FROM votes WHERE topic_id = ? AND user_id = ?)`,
            [id, req.user.id],
            (err, voteRecord) => {
              topic.options = options;
              topic.has_voted = !!voteRecord;

              if (topic.eligible_departments) {
                try { topic.eligible_departments = JSON.parse(topic.eligible_departments); } catch (e) {}
              }
              if (topic.eligible_positions) {
                try { topic.eligible_positions = JSON.parse(topic.eligible_positions); } catch (e) {}
              }

              res.json(topic);
            }
          );
        }
      );
    }
  );
};

const reviewTopic = async (req, res) => {
  const { id } = req.params;
  const { action, reason } = req.body;

  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: '无效的操作' });
  }

  db.get(`SELECT * FROM topics WHERE id = ?`, [id], async (err, topic) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    if (!topic) return res.status(404).json({ error: '议题不存在' });
    if (topic.status !== 'pending') {
      return res.status(400).json({ error: '议题状态不支持审核' });
    }

    if (req.user.role === 'manager' && topic.department_id !== req.user.department_id) {
      return res.status(403).json({ error: '无权审核其他部门的议题' });
    }

    const newStatus = action === 'approve' ? 'voting' : 'rejected';
    
    db.run(
      `UPDATE topics SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [newStatus, id],
      async function (err) {
        if (err) return res.status(500).json({ error: '审核失败' });

        await auditLog(
          action === 'approve' ? 'approve_topic' : 'reject_topic',
          'topic',
          req.user.id,
          id,
          { reason: reason || null },
          req.ip
        );

        res.json({ id, status: newStatus, message: action === 'approve' ? '审核通过，投票已开始' : '已驳回该议题' });
      }
    );
  });
};

module.exports = {
  createTopic,
  getTopicList,
  getTopicDetail,
  reviewTopic,
  validateTopic,
};
