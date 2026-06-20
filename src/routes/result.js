const express = require('express');
const router = express.Router();
const resultController = require('../controllers/resultController');
const resolutionController = require('../controllers/resolutionController');
const authMiddleware = require('../middleware/auth');
const { requireAdmin, requireManager } = require('../middleware/permission');

router.get('/:id/statistics', authMiddleware, resultController.getVoteStatistics);
router.post('/:id/finalize', authMiddleware, requireManager, resultController.finalizeTopic);

router.get('/resolutions', authMiddleware, resolutionController.getResolutionList);
router.get('/resolutions/:id', authMiddleware, resolutionController.getResolutionDetail);
router.post('/resolutions/:id/approve', authMiddleware, requireManager, resolutionController.approveResolution);
router.post('/resolutions/:id/reject', authMiddleware, requireManager, resolutionController.rejectResolution);

router.get('/tasks', authMiddleware, resolutionController.getTaskList);
router.get('/tasks/:id', authMiddleware, resolutionController.getTaskDetail);
router.post('/tasks/:id/receive', authMiddleware, resolutionController.receiveTask);
router.post('/tasks/:id/complete', authMiddleware, resolutionController.completeTask);
router.post('/tasks/:id/return', authMiddleware, resolutionController.returnTask);

module.exports = router;
