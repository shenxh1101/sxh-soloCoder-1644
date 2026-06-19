const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: '未认证' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: '权限不足，无法执行此操作' });
    }
    next();
  };
};

const requireAdmin = requireRole('admin');
const requireManager = requireRole('manager', 'admin');
const requireEmployee = requireRole('employee', 'manager', 'admin');

module.exports = { requireRole, requireAdmin, requireManager, requireEmployee };
