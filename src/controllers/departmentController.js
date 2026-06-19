const db = require('../config/database');
const { auditLog } = require('../utils/audit');

const getDepartmentList = (req, res) => {
  db.all(
    `SELECT d.*, 
            (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id) as user_count,
            m.real_name as manager_name
     FROM departments d
     LEFT JOIN users m ON d.manager_id = m.id
     ORDER BY d.id ASC`,
    [],
    (err, departments) => {
      if (err) return res.status(500).json({ error: '数据库错误' });
      res.json(departments);
    }
  );
};

const createDepartment = async (req, res) => {
  const { name, manager_id, parent_id } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: '部门名称不能为空' });
  }

  db.run(
    `INSERT INTO departments (name, manager_id, parent_id) VALUES (?, ?, ?)`,
    [name.trim(), manager_id || null, parent_id || null],
    async function (err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(400).json({ error: '部门名称已存在' });
        }
        return res.status(500).json({ error: '创建失败' });
      }

      await auditLog('create_department', 'department', req.user.id, null, { department_id: this.lastID, name }, req.ip);
      res.status(201).json({ id: this.lastID, name, manager_id, parent_id });
    }
  );
};

const updateDepartment = async (req, res) => {
  const { id } = req.params;
  const { name, manager_id, parent_id } = req.body;

  db.run(
    `UPDATE departments SET name = ?, manager_id = ?, parent_id = ? WHERE id = ?`,
    [name, manager_id || null, parent_id || null, id],
    async function (err) {
      if (err) return res.status(500).json({ error: '更新失败' });
      if (this.changes === 0) return res.status(404).json({ error: '部门不存在' });

      await auditLog('update_department', 'department', req.user.id, null, { department_id: id, name }, req.ip);
      res.json({ id, name, manager_id, parent_id });
    }
  );
};

const deleteDepartment = async (req, res) => {
  const { id } = req.params;

  db.get(`SELECT COUNT(*) as count FROM users WHERE department_id = ?`, [id], (err, result) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    if (result.count > 0) {
      return res.status(400).json({ error: '该部门下还有员工，无法删除' });
    }

    db.run(`DELETE FROM departments WHERE id = ?`, [id], async function (err) {
      if (err) return res.status(500).json({ error: '删除失败' });
      if (this.changes === 0) return res.status(404).json({ error: '部门不存在' });

      await auditLog('delete_department', 'department', req.user.id, null, { department_id: id }, req.ip);
      res.json({ message: '删除成功' });
    });
  });
};

module.exports = { getDepartmentList, createDepartment, updateDepartment, deleteDepartment };
