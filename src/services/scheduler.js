const cron = require('node-cron');
const { finalizeVote } = require('../controllers/resultController');
const { checkAndEscalate } = require('../controllers/resolutionController');
const { calculateDailyStatistics } = require('../controllers/statisticsController');
const db = require('../config/database');
const dayjs = require('dayjs');

const checkExpiredTopics = () => {
  console.log(`[${dayjs().format('YYYY-MM-DD HH:mm:ss')}] 检查到期投票...`);

  db.all(
    `SELECT id, title FROM topics WHERE status = 'voting' AND deadline < ?`,
    [dayjs().toISOString()],
    (err, topics) => {
      if (err) {
        console.error('检查到期投票失败:', err);
        return;
      }

      topics.forEach(async (topic) => {
        try {
          const result = await finalizeVote(topic.id, null, 'system');
          console.log(`自动结票：${topic.title} - ${result.result}`);
        } catch (error) {
          console.error(`结票失败 ${topic.title}:`, error.message);
        }
      });
    }
  );
};

const runDailyTasks = async () => {
  console.log(`[${dayjs().format('YYYY-MM-DD HH:mm:ss')}] 执行每日统计任务...`);

  try {
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    await calculateDailyStatistics(yesterday);
    console.log('每日统计完成');
  } catch (error) {
    console.error('每日统计失败:', error);
  }

  try {
    const count = await checkAndEscalate();
    console.log(`决议升级检查完成，升级了 ${count} 个决议`);
  } catch (error) {
    console.error('决议升级检查失败:', error);
  }
};

const initScheduledTasks = () => {
  cron.schedule('* * * * *', () => {
    checkExpiredTopics();
  });

  cron.schedule('0 0 * * *', () => {
    runDailyTasks();
  });

  cron.schedule('0 */6 * * *', () => {
    checkAndEscalate().then((count) => {
      console.log(`定期检查决议升级，升级了 ${count} 个决议`);
    }).catch(console.error);
  });

  console.log('定时任务已启动');
  console.log('- 每分钟检查到期投票');
  console.log('- 每日凌晨执行统计任务');
  console.log('- 每6小时检查决议升级');
};

module.exports = { initScheduledTasks, checkExpiredTopics, runDailyTasks };
