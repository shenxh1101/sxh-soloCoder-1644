const express = require('express');
const router = express.Router();
const recountController = require('../controllers/recountController');
const authMiddleware = require('../middleware/auth');
const { requireAdmin } = require('../middleware/permission');

router.post('/:id/recount', authMiddleware, requireAdmin, recountController.recountVotes);
router.get('/recount-logs', authMiddleware, requireAdmin, recountController.getRecountLogs);

module.exports = router;
