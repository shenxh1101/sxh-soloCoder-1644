const express = require('express');
const router = express.Router();
const departmentController = require('../controllers/departmentController');
const authMiddleware = require('../middleware/auth');
const { requireAdmin } = require('../middleware/permission');

router.get('/', authMiddleware, departmentController.getDepartmentList);
router.post('/', authMiddleware, requireAdmin, departmentController.createDepartment);
router.put('/:id', authMiddleware, requireAdmin, departmentController.updateDepartment);
router.delete('/:id', authMiddleware, requireAdmin, departmentController.deleteDepartment);

module.exports = router;
