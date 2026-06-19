const express = require('express');
const router = express.Router();
const voteController = require('../controllers/voteController');
const authMiddleware = require('../middleware/auth');

router.post('/', authMiddleware, voteController.castVote);
router.get('/my', authMiddleware, voteController.getMyVotes);

module.exports = router;
