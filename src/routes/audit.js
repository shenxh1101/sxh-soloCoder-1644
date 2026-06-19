const express = require('express');
const router = express.Router();
const auditController = require('../controllers/auditController');
const authMiddleware = require('../middleware/auth');
const { requireAdmin } = require('../middleware/permission');

router.get('/', authMiddleware, requireAdmin, auditController.getAuditLogs);
router.get('/export', authMiddleware, requireAdmin, auditController.exportAuditLogs);

module.exports = router;
