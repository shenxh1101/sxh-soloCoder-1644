const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');
const { requireAdmin } = require('../middleware/permission');
const { validate } = require('../middleware/validation');
const { registerSchema, loginSchema } = require('../middleware/validation');

router.post('/login', (req, res) => {
  const { error } = loginSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  authController.login(req, res);
});

router.post('/register', authMiddleware, requireAdmin, (req, res) => {
  const { error } = registerSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  authController.register(req, res);
});

router.get('/me', authMiddleware, authController.getCurrentUser);

router.get('/users', authMiddleware, requireAdmin, authController.getUserList);

module.exports = router;
