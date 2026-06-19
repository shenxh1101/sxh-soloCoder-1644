const db = require('../config/database');
const { auditLog } = require('../utils/audit');
const dayjs = require('dayjs');

const getResolutionList = (req, res) => {
  const { page = 1, page_size = 20, status, department_id } = req.query;
  const offset = (page - 1) * page_size;

  let whereClause = 'WHERE 1=1';
  const params = [];

  if (req.user.role === 'manager') {
    whereClause += ' AND t.department_id = ?';
    params.push(req.user.department_id);
  } else if (req.user.role === 'employee') {
    whereClause += ' AND t.submitter_id = ?';
    params.push(req.user.id);
  }

  if (status) {
    whereClause += ' AND r.status = ?';
    params.push(status);
  }
  if (department_id && req.user.role === 'admin') {
    whereClause += ' AND t.department_id = ?';
    params.push(department_id);
  }

  const countSql = `
    SELECT COUNT(*) as total 
    FROM resolutions r
    JOIN topics t ON r.topic_id = t.id
    ${whereClause}
  `;

  const listSql = `
    SELECT r.*, 
           t.title as topic_title,
           t.department_id,
           d.name as department_name,
           u.real_name as approver_name
    FROM resolutions r
    JOIN topics t ON r.topic_id = t.id
    LEFT JOIN departments d ON t.department_id = d.id
    LEFT JOIN users u ON r.approved_by = u.id
    ${whereClause}
    ORDER BY r.created_at DESC
    LIMIT ? OFFSET ?
  `;

  db.get(countSql, params, (err, countResult) => {
    if (err) return res.status(500).json({ error: '数据库错误' });

    db.all(listSql, [...params, parseInt(page_size), offset], (err, resolutions) => {
      if (err) return res.status(500).json({ error: '数据库错误' });

      res.json({
        list: resolutions,
        total: countResult.total,
        page: parseInt(page),
        page_size: parseInt(page_size),
      });
    });
  });
};

const getResolutionDetail = (req, res) => {
  const { id } = req.params;

  db.get(
    `SELECT r.*, 
            t.title as topic_title,
            t.description as topic_description,
            t.department_id,
            t.vote_rule,
            d.name as department_name,
            u.real_name as approver_name
     FROM resolutions r
     JOIN topics t ON r.topic_id = t.id
     LEFT JOIN departments d ON t.department_id = d.id
     LEFT JOIN users u ON r.approved_by = u.id
     WHERE r.id = ?`,
    [id],
    (err, resolution) => {
      if (err) return res.status(500).json({ error: '数据库错误' });
      if (!resolution) return res.status(404).json({ error: '决议不存在' });

      if (req.user.role === 'employee' && resolution.submitter_id !== req.user.id) {
        return res.status(403).json({ error: '无权查看此决议' });
      }
      if (req.user.role === 'manager' && resolution.department_id !== req.user.department_id) {
        return res.status(403).json({ error: '无权查看此决议' });
      }

      db.all(
        `SELECT * FROM tasks WHERE resolution_id = ? ORDER BY created_at DESC`,
        [id],
        (err, tasks) => {
          if (err) return res.status(500).json({ error: '数据库错误' });
          resolution.tasks = tasks;
          res.json(resolution);
        }
      );
    }
  );
};

const approveResolution = async (req, res) => {
  const { id } = req.params;

  db.get(`SELECT * FROM resolutions WHERE id = ?`, [id], async (err, resolution) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    if (!resolution) return res.status(404).json({ error: '决议不存在' });
    if (resolution.status !== 'pending') {
      return res.status(400).json({ error: '决议状态不支持审批' });
    }

    db.get(`SELECT * FROM topics WHERE id = ?`, [resolution.topic_id], async (err, topic) => {
      if (err) return res.status(500).json({ error: '数据库错误' });

      if (req.user.role === 'manager' && topic.department_id !== req.user.department_id) {
        return res.status(403).json({ error: '无权审批此决议' });
      }

      db.run(
        `UPDATE resolutions SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [req.user.id, id],
        async function (err) {
          if (err) return res.status(500).json({ error: '审批失败' });

          if (resolution.result && resolution.result.startsWith('通过')) {
            const taskId = await createTaskFromResolution(resolution, topic, req.user.id);
            await auditLog('create_task', 'task', req.user.id, topic.id, { task_id: taskId, resolution_id: id }, req.ip);
          }

          db.run(
            `UPDATE topics SET status = 'resolved', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [topic.id],
            async (err) => {
              if (err) return res.status(500).json({ error: '更新议题状态失败' });

              await auditLog('approve_resolution', 'resolution', req.user.id, topic.id, { resolution_id: id }, req.ip);
              res.json({ id, status: 'approved', message: '决议已通过' });
            }
          );
        }
      );
    });
  });
};

const createTaskFromResolution = (resolution, topic, creatorId) => {
  return new Promise((resolve, reject) => {
    const taskTitle = `执行投票决议：${topic.title}`;
    const taskDesc = `根据投票决议结果：${resolution.result}，请相关部门跟进执行。`;

    db.run(
      `INSERT INTO tasks (resolution_id, topic_id, title, description, assignee_department_id, status, priority)
       VALUES (?, ?, ?, ?, ?, 'pending', 'medium')`,
      [resolution.id, topic.id, taskTitle, taskDesc, topic.department_id],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
};

const rejectResolution = async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  db.get(`SELECT * FROM resolutions WHERE id = ?`, [id], async (err, resolution) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    if (!resolution) return res.status(404).json({ error: '决议不存在' });
    if (resolution.status !== 'pending') {
      return res.status(400).json({ error: '决议状态不支持驳回' });
    }

    db.get(`SELECT * FROM topics WHERE id = ?`, [resolution.topic_id], async (err, topic) => {
      if (err) return res.status(500).json({ error: '数据库错误' });

      if (req.user.role === 'manager' && topic.department_id !== req.user.department_id) {
        return res.status(403).json({ error: '无权驳回此决议' });
      }

      db.run(
        `UPDATE resolutions SET status = 'rejected' WHERE id = ?`,
        [id],
        async function (err) {
          if (err) return res.status(500).json({ error: '驳回失败' });

          await auditLog('reject_resolution', 'resolution', req.user.id, topic.id, { resolution_id: id, reason }, req.ip);
          res.json({ id, status: 'rejected', message: '决议已驳回' });
        }
      );
    });
  });
};

const checkAndEscalate = () => {
  return new Promise((resolve, reject) => {
    const cutoffTime = dayjs().subtract(48, 'hour').toISOString();

    db.all(
      `SELECT r.*, t.department_id, t.title as topic_title, d.parent_id
       FROM resolutions r
       JOIN topics t ON r.topic_id = t.id
       LEFT JOIN departments d ON t.department_id = d.id
       WHERE r.status = 'pending' 
         AND r.escalated = 0 
         AND r.created_at < ?
         AND d.parent_id IS NOT NULL`,
      [cutoffTime],
      (err, resolutions) => {
        if (err) return reject(err);

        const escalations = resolutions.map(async (r) => {
          await new Promise((res, rej) => {
            db.run(
              `UPDATE resolutions SET escalated = 1 WHERE id = ?`,
              [r.id],
              (err) => {
                if (err) rej(err);
                else res();
              }
            );
          });

          await auditLog(
            'escalate_resolution',
            'resolution',
            null,
            r.topic_id,
            { resolution_id: r.id, reason: '超过48小时未审批，自动升级至上级主管' },
            null
          );
        });

        Promise.all(escalations)
          .then(() => resolve(resolutions.length))
          .catch(reject);
      }
    );
  });
};

const getTaskList = (req, res) => {
  const { page = 1, page_size = 20, status, department_id } = req.query;
  const offset = (page - 1) * page_size;

  let whereClause = 'WHERE 1=1';
  const params = [];

  if (req.user.role === 'manager') {
    whereClause += ' AND t.assignee_department_id = ?';
    params.push(req.user.department_id);
  } else if (req.user.role === 'employee') {
    whereClause += ' AND 1=0';
  }

  if (status) {
    whereClause += ' AND t.status = ?';
    params.push(status);
  }

  const countSql = `SELECT COUNT(*) as total FROM tasks t ${whereClause}`;
  const listSql = `
    SELECT t.*, 
           d.name as department_name,
           top.title as topic_title
    FROM tasks t
    LEFT JOIN departments d ON t.assignee_department_id = d.id
    LEFT JOIN topics top ON t.topic_id = top.id
    ${whereClause}
    ORDER BY t.created_at DESC
    LIMIT ? OFFSET ?
  `;

  db.get(countSql, params, (err, countResult) => {
    if (err) return res.status(500).json({ error: '数据库错误' });

    db.all(listSql, [...params, parseInt(page_size), offset], (err, tasks) => {
      if (err) return res.status(500).json({ error: '数据库错误' });

      res.json({
        list: tasks,
        total: countResult.total,
        page: parseInt(page),
        page_size: parseInt(page_size),
      });
    });
  });
};

module.exports = {
  getResolutionList,
  getResolutionDetail,
  approveResolution,
  rejectResolution,
  getTaskList,
  checkAndEscalate,
  createTaskFromResolution,
};
