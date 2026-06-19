const express = require('express');
const router = express.Router();
const statisticsController = require('../controllers/statisticsController');
const authMiddleware = require('../middleware/auth');
const { requireAdmin, requireManager } = require('../middleware/permission');

router.get('/', authMiddleware, requireManager, statisticsController.getStatistics);
router.post('/trigger', authMiddleware, requireAdmin, statisticsController.triggerStatistics);
router.get('/departments', authMiddleware, requireAdmin, statisticsController.getDepartmentStatistics);
router.get('/export/excel', authMiddleware, requireAdmin, statisticsController.exportExcelReport);
router.get('/export/pdf', authMiddleware, requireAdmin, statisticsController.exportPdfReport);

module.exports = router;
