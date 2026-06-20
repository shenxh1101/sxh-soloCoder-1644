const db = require('../config/database');
const { auditLog } = require('../utils/audit');
const dayjs = require('dayjs');

const getResolutionList = (req, res) => {
  const { page = 1, page_size = 20, status, department_id, min_hours_pending, escalated } = req.query;
  const offset = (page - 1) * page_size;

  let whereClause = 'WHERE 1=1';
  const params = [];

  if (req.user.role === 'manager') {
    whereClause += ` AND (
      t.department_id = ?
      OR r.escalated = 1 AND EXISTS (
        SELECT 1 FROM departments child
        JOIN departments parent ON child.parent_id = parent.id
        WHERE child.id = t.department_id AND parent.manager_id = ?
      )
    )`;
    params.push(req.user.department_id, req.user.id);
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
  if (min_hours_pending !== undefined && min_hours_pending !== null && min_hours_pending !== '') {
    whereClause += " AND (JULIANDAY('now') - JULIANDAY(r.created_at)) * 24 >= ?";
    params.push(parseFloat(min_hours_pending));
  }
  if (escalated !== undefined && escalated !== null && escalated !== '') {
    whereClause += ' AND r.escalated = ?';
    params.push(parseInt(escalated));
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
           u.real_name as approver_name,
           du.real_name as dept_manager_name,
           CASE WHEN r.escalated = 1 THEN '已升级至上级主管' ELSE '正常' END as escalation_status
    FROM resolutions r
    JOIN topics t ON r.topic_id = t.id
    LEFT JOIN departments d ON t.department_id = d.id
    LEFT JOIN users u ON r.approved_by = u.id
    LEFT JOIN users du ON d.manager_id = du.id
    ${whereClause}
    ORDER BY r.escalated DESC, r.created_at DESC
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
            d.manager_id as dept_manager_id,
            d.parent_id as parent_dept_id,
            u.real_name as approver_name,
            dm.real_name as dept_manager_name,
            pd.name as parent_dept_name,
            pdm.real_name as parent_dept_manager_name,
            CASE WHEN r.escalated = 1 THEN '已升级至上级主管' ELSE '正常' END as escalation_status,
            CASE WHEN r.escalated = 1 THEN 1 ELSE 0 END as is_escalated
     FROM resolutions r
     JOIN topics t ON r.topic_id = t.id
     LEFT JOIN departments d ON t.department_id = d.id
     LEFT JOIN users u ON r.approved_by = u.id
     LEFT JOIN users dm ON d.manager_id = dm.id
     LEFT JOIN departments pd ON d.parent_id = pd.id
     LEFT JOIN users pdm ON pd.manager_id = pdm.id
     WHERE r.id = ?`,
    [id],
    (err, resolution) => {
      if (err) return res.status(500).json({ error: '数据库错误' });
      if (!resolution) return res.status(404).json({ error: '决议不存在' });

      if (req.user.role === 'employee' && resolution.submitter_id !== req.user.id) {
        return res.status(403).json({ error: '无权查看此决议' });
      }

      if (req.user.role === 'manager') {
        const ownDept = resolution.department_id === req.user.department_id;
        const escalatedAndParentMgr = resolution.is_escalated && resolution.parent_dept_id !== null;
        if (!ownDept && !escalatedAndParentMgr) {
          return res.status(403).json({ error: '无权查看此决议' });
        }
      }

      db.all(
        `SELECT tk.*, 
                d.name as department_name,
                top.title as topic_title,
                u.real_name as assignee_name,
                mu.real_name as dept_manager_name
         FROM tasks tk
         LEFT JOIN departments d ON tk.assignee_department_id = d.id
         LEFT JOIN topics top ON tk.topic_id = top.id
         LEFT JOIN users u ON tk.assignee_user_id = u.id
         LEFT JOIN users mu ON d.manager_id = mu.id
         WHERE tk.resolution_id = ? 
         ORDER BY tk.created_at DESC`,
        [id],
        (err, tasks) => {
          if (err) return res.status(500).json({ error: '数据库错误' });

          const tasksWithAssignee = tasks.map((task) => ({
            ...task,
            assignee_display: task.assignee_name || task.dept_manager_name || '待分配',
          }));

          db.get(
            `SELECT created_at FROM resolutions WHERE id = ?`,
            [id],
            (err, timeRow) => {
              const createdAt = timeRow ? new Date(timeRow.created_at) : new Date();
              const hoursElapsed = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
              resolution.time_since_created = {
                hours: Math.round(hoursElapsed * 10) / 10,
                days: Math.round(hoursElapsed / 24 * 10) / 10,
                escalation_deadline: dayjs(createdAt).add(48, 'hour').format('YYYY-MM-DD HH:mm:ss'),
                hours_until_escalation: Math.max(0, Math.round((48 - hoursElapsed) * 10) / 10),
              };

              resolution.tasks = tasksWithAssignee;
              res.json(resolution);
            }
          );
        }
      );
    }
  );
};

const findParentManagerId = (departmentId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT pd.manager_id 
       FROM departments d
       JOIN departments pd ON d.parent_id = pd.id
       WHERE d.id = ?`,
      [departmentId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.manager_id : null);
      }
    );
  });
};

const approveResolution = async (req, res) => {
  const { id } = req.params;

  db.get(
    `SELECT r.*, t.department_id, d.parent_id 
     FROM resolutions r
     JOIN topics t ON r.topic_id = t.id
     LEFT JOIN departments d ON t.department_id = d.id
     WHERE r.id = ?`,
    [id],
    async (err, resolution) => {
      if (err) return res.status(500).json({ error: '数据库错误' });
      if (!resolution) return res.status(404).json({ error: '决议不存在' });
      if (resolution.status !== 'pending') {
        return res.status(400).json({ error: '决议状态不支持审批' });
      }

      if (req.user.role === 'manager') {
        const ownDept = resolution.department_id === req.user.department_id;
        if (!ownDept) {
          if (resolution.escalated === 1 && resolution.parent_id !== null) {
            const parentMgrId = await findParentManagerId(resolution.department_id);
            if (parentMgrId !== req.user.id) {
              return res.status(403).json({ error: '无权审批此决议，已升级至上级主管' });
            }
          } else {
            return res.status(403).json({ error: '无权审批其他部门的决议' });
          }
        }
      }

      db.run(
        `UPDATE resolutions SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [req.user.id, id],
        async function (err) {
          if (err) return res.status(500).json({ error: '审批失败' });

          let taskId = null;
          if (resolution.result && resolution.result.startsWith('通过')) {
            taskId = await createTaskFromResolution(resolution.id, resolution.topic_id, resolution.result, resolution.department_id, req.user.id);
            await auditLog('create_task', 'task', req.user.id, resolution.topic_id, { task_id: taskId, resolution_id: id }, req.ip);
          }

          db.run(
            `UPDATE topics SET status = 'resolved', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [resolution.topic_id],
            async (err) => {
              if (err) return res.status(500).json({ error: '更新议题状态失败' });

              await auditLog('approve_resolution', 'resolution', req.user.id, resolution.topic_id, { resolution_id: id }, req.ip);
              res.json({
                id,
                status: 'approved',
                message: '决议已通过' + (taskId ? `，执行任务已生成（任务ID: ${taskId}）` : ''),
                task_id: taskId,
              });
            }
          );
        }
      );
    }
  );
};

const createTaskFromResolution = (resolutionId, topicId, resultText, departmentId, operatorId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT manager_id FROM departments WHERE id = ?`,
      [departmentId],
      (err, dept) => {
        if (err) return reject(err);
        const managerId = dept ? dept.manager_id : null;

        const title = `执行投票决议`;
        const desc = `投票议题 #${topicId} 决议结果：${resultText}。请跟进执行相关事项。`;
        const dueDate = dayjs().add(30, 'day').format('YYYY-MM-DD HH:mm:ss');

        db.run(
          `INSERT INTO tasks (resolution_id, topic_id, title, description, assignee_department_id, assignee_user_id, current_handler_id, status, priority, due_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'assigned', 'high', ?)`,
          [resolutionId, topicId, title, desc, departmentId, managerId, managerId, dueDate],
          function (err) {
            if (err) return reject(err);
            const taskId = this.lastID;

            db.run(
              `INSERT INTO task_operation_logs (task_id, operator_id, action, from_status, to_status, remark, previous_handler_id, new_handler_id, ip_address)
               VALUES (?, ?, 'CREATE', NULL, 'assigned', '从决议自动创建任务', NULL, ?, NULL)`,
              [taskId, operatorId, managerId],
              (logErr) => {
                if (logErr) {
                }

                auditLog(
                  'assign_task',
                  'task',
                  operatorId,
                  topicId,
                  { task_id: taskId, assignee_user_id: managerId, assignee_department_id: departmentId },
                  null
                );
                resolve(taskId);
              }
            );
          }
        );
      }
    );
  });
};

const rejectResolution = async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  db.get(
    `SELECT r.*, t.department_id, d.parent_id 
     FROM resolutions r
     JOIN topics t ON r.topic_id = t.id
     LEFT JOIN departments d ON t.department_id = d.id
     WHERE r.id = ?`,
    [id],
    async (err, resolution) => {
      if (err) return res.status(500).json({ error: '数据库错误' });
      if (!resolution) return res.status(404).json({ error: '决议不存在' });
      if (resolution.status !== 'pending') {
        return res.status(400).json({ error: '决议状态不支持驳回' });
      }

      if (req.user.role === 'manager') {
        const ownDept = resolution.department_id === req.user.department_id;
        if (!ownDept) {
          if (resolution.escalated === 1 && resolution.parent_id !== null) {
            const parentMgrId = await findParentManagerId(resolution.department_id);
            if (parentMgrId !== req.user.id) {
              return res.status(403).json({ error: '无权驳回此决议' });
            }
          } else {
            return res.status(403).json({ error: '无权驳回其他部门的决议' });
          }
        }
      }

      db.run(
        `UPDATE resolutions SET status = 'rejected' WHERE id = ?`,
        [id],
        async function (err) {
          if (err) return res.status(500).json({ error: '驳回失败' });

          await auditLog('reject_resolution', 'resolution', req.user.id, resolution.topic_id, { resolution_id: id, reason }, req.ip);
          res.json({ id, status: 'rejected', message: '决议已驳回' });
        }
      );
    }
  );
};

const checkAndEscalate = () => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT r.id, r.topic_id, t.title as topic_title, t.department_id, d.parent_id, d.name as dept_name
       FROM resolutions r
       JOIN topics t ON r.topic_id = t.id
       LEFT JOIN departments d ON t.department_id = d.id
       WHERE r.status = 'pending' 
         AND r.escalated = 0 
         AND (JULIANDAY('now') - JULIANDAY(r.created_at)) * 24 >= 48`,
      [],
      (err, resolutions) => {
        if (err) return reject(err);
        if (resolutions.length === 0) return resolve(0);

        let processed = 0;
        const processNext = (index) => {
          if (index >= resolutions.length) {
            resolve(processed);
            return;
          }

          const r = resolutions[index];
          db.run(
            `UPDATE resolutions SET escalated = 1 WHERE id = ? AND status = 'pending' AND (JULIANDAY('now') - JULIANDAY(created_at)) * 24 >= 48`,
            [r.id],
            async function (err) {
              if (err) {
                processNext(index + 1);
                return;
              }
              if (this.changes === 0) {
                processNext(index + 1);
                return;
              }

              try {
                await auditLog(
                  'escalate_resolution',
                  'resolution',
                  null,
                  r.topic_id,
                  {
                    resolution_id: r.id,
                    reason: '超过48小时未审批，自动升级至上级主管',
                    original_department: r.dept_name,
                    original_department_id: r.department_id,
                    parent_department_id: r.parent_id,
                  },
                  null
                );
              } catch (e) {
              }
              processed++;
              processNext(index + 1);
            }
          );
        };

        processNext(0);
      }
    );
  });
};

const getTaskList = (req, res) => {
  const { page = 1, page_size = 20, status, department_id, assignee_user_id } = req.query;
  const offset = (page - 1) * page_size;

  let whereClause = 'WHERE 1=1';
  const params = [];

  if (req.user.role === 'manager') {
    whereClause += ' AND tk.assignee_department_id = ?';
    params.push(req.user.department_id);
  } else if (req.user.role === 'employee') {
    whereClause += ' AND (tk.current_handler_id = ? OR tk.assignee_user_id = ?)';
    params.push(req.user.id, req.user.id);
  }

  if (status) {
    whereClause += ' AND tk.status = ?';
    params.push(status);
  }
  if (department_id && req.user.role === 'admin') {
    whereClause += ' AND tk.assignee_department_id = ?';
    params.push(department_id);
  }
  if (assignee_user_id) {
    whereClause += ' AND tk.assignee_user_id = ?';
    params.push(assignee_user_id);
  }

  const countSql = `SELECT COUNT(*) as total FROM tasks tk ${whereClause}`;
  const listSql = `
    SELECT tk.*, 
           d.name as department_name,
           top.title as topic_title,
           u.real_name as assignee_name,
           mgr.real_name as dept_manager_name,
           COALESCE(u.real_name, mgr.real_name, '待分配') as assignee_display,
           r.result as resolution_result,
           r.status as resolution_status,
           r.escalated as resolution_escalated,
           CASE WHEN r.escalated = 1 THEN '决议已升级' ELSE NULL END as task_escalation_note
    FROM tasks tk
    LEFT JOIN departments d ON tk.assignee_department_id = d.id
    LEFT JOIN topics top ON tk.topic_id = top.id
    LEFT JOIN users u ON tk.assignee_user_id = u.id
    LEFT JOIN users mgr ON d.manager_id = mgr.id
    LEFT JOIN resolutions r ON tk.resolution_id = r.id
    ${whereClause}
    ORDER BY tk.priority = 'high' DESC, tk.created_at DESC
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

const receiveTask = (req, res) => {
  const { id } = req.params;

  db.get(
    `SELECT * FROM tasks WHERE id = ?`,
    [id],
    (err, task) => {
      if (err) return res.status(500).json({ error: '数据库错误' });
      if (!task) return res.status(404).json({ error: '任务不存在' });

      if (task.current_handler_id !== req.user.id) {
        return res.status(403).json({ error: '只有任务负责人可以领取此任务' });
      }
      if (task.status !== 'assigned') {
        return res.status(400).json({ error: '任务状态不支持领取操作' });
      }

      db.run(
        `UPDATE tasks SET status = 'in_progress', received_at = CURRENT_TIMESTAMP, current_handler_id = ?, last_operation_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [req.user.id, id],
        function (updateErr) {
          if (updateErr) return res.status(500).json({ error: '领取任务失败' });

          db.run(
            `INSERT INTO task_operation_logs (task_id, operator_id, action, from_status, to_status, remark, previous_handler_id, new_handler_id, ip_address)
             VALUES (?, ?, 'RECEIVE', 'assigned', 'in_progress', '负责人领取任务', ?, ?, ?)`,
            [id, req.user.id, task.current_handler_id, req.user.id, req.ip],
            async (logErr) => {
              if (logErr) {
              }

              try {
                await auditLog('receive_task', 'task', req.user.id, task.topic_id, { task_id: id }, req.ip);
              } catch (e) {
              }

              res.json({
                id,
                status: 'in_progress',
                message: '任务已领取',
              });
            }
          );
        }
      );
    }
  );
};

const completeTask = (req, res) => {
  const { id } = req.params;
  const { remark } = req.body;

  db.get(
    `SELECT * FROM tasks WHERE id = ?`,
    [id],
    (err, task) => {
      if (err) return res.status(500).json({ error: '数据库错误' });
      if (!task) return res.status(404).json({ error: '任务不存在' });

      if (task.current_handler_id !== req.user.id) {
        return res.status(403).json({ error: '只有任务负责人可以完成此任务' });
      }
      if (task.status !== 'in_progress') {
        return res.status(400).json({ error: '任务状态不支持完成操作' });
      }

      db.run(
        `UPDATE tasks SET status = 'completed', completed_at = CURRENT_TIMESTAMP, last_remark = ?, last_operation_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [remark || null, id],
        function (updateErr) {
          if (updateErr) return res.status(500).json({ error: '完成任务失败' });

          db.run(
            `INSERT INTO task_operation_logs (task_id, operator_id, action, from_status, to_status, remark, previous_handler_id, new_handler_id, ip_address)
             VALUES (?, ?, 'COMPLETE', 'in_progress', 'completed', ?, ?, ?, ?)`,
            [id, req.user.id, remark || '任务已完成', task.current_handler_id, task.current_handler_id, req.ip],
            async (logErr) => {
              if (logErr) {
              }

              try {
                await auditLog('complete_task', 'task', req.user.id, task.topic_id, { task_id: id, remark }, req.ip);
              } catch (e) {
              }

              res.json({
                id,
                status: 'completed',
                message: '任务已完成',
              });
            }
          );
        }
      );
    }
  );
};

const returnTask = (req, res) => {
  const { id } = req.params;
  const { remark } = req.body;

  db.get(
    `SELECT * FROM tasks WHERE id = ?`,
    [id],
    (err, task) => {
      if (err) return res.status(500).json({ error: '数据库错误' });
      if (!task) return res.status(404).json({ error: '任务不存在' });

      if (task.current_handler_id !== req.user.id) {
        return res.status(403).json({ error: '只有任务负责人可以退回此任务' });
      }
      if (task.status !== 'in_progress') {
        return res.status(400).json({ error: '任务状态不支持退回操作' });
      }

      const newReturnedCount = (task.returned_count || 0) + 1;

      db.run(
        `UPDATE tasks SET status = 'returned', returned_count = ?, last_remark = ?, last_operation_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [newReturnedCount, remark || null, id],
        function (updateErr) {
          if (updateErr) return res.status(500).json({ error: '退回任务失败' });

          db.run(
            `INSERT INTO task_operation_logs (task_id, operator_id, action, from_status, to_status, remark, previous_handler_id, new_handler_id, ip_address)
             VALUES (?, ?, 'RETURN', 'in_progress', 'returned', ?, ?, NULL, ?)`,
            [id, req.user.id, remark || '任务已退回', task.current_handler_id, req.ip],
            async (logErr) => {
              if (logErr) {
              }

              try {
                await auditLog('return_task', 'task', req.user.id, task.topic_id, { task_id: id, remark, returned_count: newReturnedCount }, req.ip);
              } catch (e) {
              }

              res.json({
                id,
                status: 'returned',
                returned_count: newReturnedCount,
                message: '任务已退回',
              });
            }
          );
        }
      );
    }
  );
};

const getTaskDetail = (req, res) => {
  const { id } = req.params;

  db.get(
    `SELECT tk.*, 
            d.name as department_name,
            top.title as topic_title,
            u.real_name as assignee_name,
            ch.real_name as current_handler_name,
            mgr.real_name as dept_manager_name,
            COALESCE(u.real_name, mgr.real_name, '待分配') as assignee_display,
            r.result as resolution_result,
            r.status as resolution_status,
            r.escalated as resolution_escalated
     FROM tasks tk
     LEFT JOIN departments d ON tk.assignee_department_id = d.id
     LEFT JOIN topics top ON tk.topic_id = top.id
     LEFT JOIN users u ON tk.assignee_user_id = u.id
     LEFT JOIN users ch ON tk.current_handler_id = ch.id
     LEFT JOIN users mgr ON d.manager_id = mgr.id
     LEFT JOIN resolutions r ON tk.resolution_id = r.id
     WHERE tk.id = ?`,
    [id],
    (err, task) => {
      if (err) return res.status(500).json({ error: '数据库错误' });
      if (!task) return res.status(404).json({ error: '任务不存在' });

      if (req.user.role === 'manager') {
        if (task.assignee_department_id !== req.user.department_id) {
          return res.status(403).json({ error: '无权查看此任务' });
        }
      } else if (req.user.role === 'employee') {
        if (task.current_handler_id !== req.user.id && task.assignee_user_id !== req.user.id) {
          return res.status(403).json({ error: '无权查看此任务' });
        }
      }

      let overdue = false;
      let overdue_days = 0;
      if (task.due_date && task.status !== 'completed') {
        const dueDate = new Date(task.due_date);
        const now = new Date();
        const diffMs = now - dueDate;
        if (diffMs > 0) {
          overdue = true;
          overdue_days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        }
      }

      db.all(
        `SELECT tol.*, u.real_name as operator_name, 
                ph.real_name as previous_handler_name,
                nh.real_name as new_handler_name
         FROM task_operation_logs tol
         LEFT JOIN users u ON tol.operator_id = u.id
         LEFT JOIN users ph ON tol.previous_handler_id = ph.id
         LEFT JOIN users nh ON tol.new_handler_id = nh.id
         WHERE tol.task_id = ?
         ORDER BY tol.created_at ASC`,
        [id],
        (logErr, logs) => {
          if (logErr) return res.status(500).json({ error: '查询操作日志失败' });

          const result = {
            ...task,
            overdue,
            overdue_days,
            operation_logs: logs,
          };

          res.json(result);
        }
      );
    }
  );
};

module.exports = {
  getResolutionList,
  getResolutionDetail,
  approveResolution,
  rejectResolution,
  getTaskList,
  checkAndEscalate,
  createTaskFromResolution,
  receiveTask,
  completeTask,
  returnTask,
  getTaskDetail,
};
