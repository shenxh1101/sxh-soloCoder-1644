require('dotenv').config();
const express = require('express');
const cors = require('cors');
const initDatabase = require('./models');
const initSampleData = require('./services/seed');
const { initScheduledTasks } = require('./services/scheduler');

const authRoutes = require('./routes/auth');
const departmentRoutes = require('./routes/department');
const topicRoutes = require('./routes/topic');
const voteRoutes = require('./routes/vote');
const resultRoutes = require('./routes/result');
const auditRoutes = require('./routes/audit');
const recountRoutes = require('./routes/recount');
const statisticsRoutes = require('./routes/statistics');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth', authRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/topics', topicRoutes);
app.use('/api/votes', voteRoutes);
app.use('/api/results', resultRoutes);
app.use('/api/audit-logs', auditRoutes);
app.use('/api', recountRoutes);
app.use('/api/statistics', statisticsRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: '投票管理系统运行正常' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: '服务器内部错误' });
});

app.use((req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

const startServer = async () => {
  try {
    await initDatabase();
    console.log('数据库初始化完成');

    await initSampleData();
    console.log('示例数据初始化完成');

    initScheduledTasks();

    app.listen(PORT, () => {
      console.log(`
╔═══════════════════════════════════════════╗
║     投票管理系统启动成功                    ║
║     服务地址: http://localhost:${PORT}          ║
║     健康检查: http://localhost:${PORT}/api/health ║
╚═══════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('启动失败:', error);
    process.exit(1);
  }
};

startServer();
