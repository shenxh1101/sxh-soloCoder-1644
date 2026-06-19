const express = require('express');
const router = express.Router();
const topicController = require('../controllers/topicController');
const authMiddleware = require('../middleware/auth');
const { requireAdmin, requireManager } = require('../middleware/permission');

router.post('/', authMiddleware, topicController.createTopic);
router.get('/', authMiddleware, topicController.getTopicList);
router.get('/:id', authMiddleware, topicController.getTopicDetail);
router.post('/:id/review', authMiddleware, requireManager, topicController.reviewTopic);

module.exports = router;
