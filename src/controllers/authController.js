const db = require('../config/database');
const { generateToken } = require('../utils/jwt');
const { hashPassword, comparePassword } = require('../utils/password');
const { auditLog } = require('../utils/audit');

const login = async (req, res) => {
  const { username, password } = req.body;

  db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
    if (err) {
      return res.status(500).json({ error: '数据库错误' });
    }

    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ error: '账户已被禁用' });
    }

    if (!comparePassword(password, user.password)) {
      await auditLog('login_failed', 'auth', user.id, null, { reason: 'password_mismatch' }, req.ip);
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const token = generateToken(user);
    await auditLog('login_success', 'auth', user.id, null, null, req.ip);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        real_name: user.real_name,
        email: user.email,
        department_id: user.department_id,
        position: user.position,
        role: user.role,
      },
    });
  });
};

const register = async (req, res) => {
  const { username, password, real_name, email, department_id, position, role } = req.body;

  db.get(`SELECT id FROM users WHERE username = ?`, [username], async (err, existing) => {
    if (err) {
      return res.status(500).json({ error: '数据库错误' });
    }

    if (existing) {
      return res.status(400).json({ error: '用户名已存在' });
    }

    const hashedPassword = hashPassword(password);

    db.run(
      `INSERT INTO users (username, password, real_name, email, department_id, position, role) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [username, hashedPassword, real_name, email || null, department_id || null, position || null, role || 'employee'],
      async function (err) {
        if (err) {
          return res.status(500).json({ error: '注册失败：' + err.message });
        }

        const userId = this.lastID;
        await auditLog('user_register', 'user', userId, null, { username, role }, req.ip);

        res.status(201).json({
          id: userId,
          username,
          real_name,
          role: role || 'employee',
        });
      }
    );
  });
};

const getCurrentUser = (req, res) => {
  db.get(
    `SELECT u.id, u.username, u.real_name, u.email, u.department_id, u.position, u.role, 
            d.name as department_name 
     FROM users u 
     LEFT JOIN departments d ON u.department_id = d.id 
     WHERE u.id = ?`,
    [req.user.id],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: '数据库错误' });
      }
      if (!user) {
        return res.status(404).json({ error: '用户不存在' });
      }
      res.json(user);
    }
  );
};

const getUserList = (req, res) => {
  const { page = 1, page_size = 20, department_id, role, keyword } = req.query;
  const offset = (page - 1) * page_size;
  
  let whereClause = 'WHERE 1=1';
  const params = [];

  if (department_id) {
    whereClause += ' AND u.department_id = ?';
    params.push(department_id);
  }
  if (role) {
    whereClause += ' AND u.role = ?';
    params.push(role);
  }
  if (keyword) {
    whereClause += ' AND (u.username LIKE ? OR u.real_name LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const countSql = `SELECT COUNT(*) as total FROM users u ${whereClause}`;
  const listSql = `
    SELECT u.id, u.username, u.real_name, u.email, u.department_id, u.position, u.role, u.status,
           d.name as department_name
    FROM users u
    LEFT JOIN departments d ON u.department_id = d.id
    ${whereClause}
    ORDER BY u.id DESC
    LIMIT ? OFFSET ?
  `;

  db.get(countSql, params, (err, countResult) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    
    db.all(listSql, [...params, parseInt(page_size), offset], (err, users) => {
      if (err) return res.status(500).json({ error: '数据库错误' });
      
      res.json({
        list: users,
        total: countResult.total,
        page: parseInt(page),
        page_size: parseInt(page_size),
      });
    });
  });
};

module.exports = { login, register, getCurrentUser, getUserList };
