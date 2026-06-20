const express = require('express');
const router = express.Router();
const auditController = require('../controllers/auditController');
const authMiddleware = require('../middleware/auth');
const { requireAdmin } = require('../middleware/permission');

router.get('/', authMiddleware, requireAdmin, auditController.getAuditLogs);
router.get('/filters', authMiddleware, requireAdmin, auditController.getAuditLogFilters);
router.get('/export', authMiddleware, requireAdmin, auditController.exportAuditLogs);
router.get('/export-records', authMiddleware, requireAdmin, auditController.getExportRecords);
router.get('/export-download', authMiddleware, requireAdmin, auditController.downloadExportRecord);

module.exports = router;
