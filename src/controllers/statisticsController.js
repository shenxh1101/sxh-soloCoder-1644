const db = require('../config/database');
const dayjs = require('dayjs');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const calculateDailyStatistics = (date = null) => {
  return new Promise((resolve, reject) => {
    const statDate = date || dayjs().format('YYYY-MM-DD');

    db.all(`SELECT id FROM departments`, [], (err, departments) => {
      if (err) return reject(err);

      const stats = [];
      const departmentIds = departments.map((d) => d.id);
      departmentIds.push(null);

      let pending = departmentIds.length;

      departmentIds.forEach((deptId) => {
        const deptWhere = deptId ? 'AND t.department_id = ?' : '';
        const deptParams = deptId ? [deptId] : [];

        db.get(
          `SELECT 
            COUNT(*) as total_topics,
            SUM(CASE WHEN t.result LIKE '通过%' THEN 1 ELSE 0 END) as passed_topics,
            (SELECT COUNT(DISTINCT v.user_id) FROM votes v 
             JOIN topics t2 ON v.topic_id = t2.id
             WHERE DATE(v.voted_at) = ? ${deptWhere ? 'AND t2.department_id = ?' : ''}) as total_voters
           FROM topics t
           WHERE DATE(t.created_at) = ? ${deptWhere}`,
          [statDate, ...deptParams, statDate, ...deptParams],
          (err, row) => {
            if (err) {
              pending = -1;
              return reject(err);
            }

            const totalTopics = row.total_topics || 0;
            const passedTopics = row.passed_topics || 0;
            const totalVoters = row.total_voters || 0;

            let totalEmployees = 0;
            const userWhere = deptId ? 'WHERE department_id = ?' : '';
            const userParams = deptId ? [deptId] : [];

            db.get(
              `SELECT COUNT(*) as count FROM users ${userWhere} AND role = 'employee' AND status = 'active'`,
              userParams,
              (err, userResult) => {
                if (err) {
                  pending = -1;
                  return reject(err);
                }
                totalEmployees = userResult.count;

                const participationRate = totalEmployees > 0 ? (totalVoters / totalEmployees) * 100 : 0;
                const passRate = totalTopics > 0 ? (passedTopics / totalTopics) * 100 : 0;

                db.get(
                  `SELECT AVG(vote_count) as avg_votes FROM (
                    SELECT COUNT(*) as vote_count FROM votes v
                    JOIN topics t ON v.topic_id = t.id
                    WHERE DATE(t.created_at) = ? ${deptWhere}
                    GROUP BY t.id
                  )`,
                  [statDate, ...deptParams],
                  (err, avgResult) => {
                    if (err) {
                      pending = -1;
                      return reject(err);
                    }

                    const avgVotes = avgResult.avg_votes || 0;

                    db.run(
                      `INSERT OR REPLACE INTO daily_statistics 
                       (stat_date, department_id, total_topics, passed_topics, total_voters, 
                        participation_rate, pass_rate, avg_votes)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                      [
                        statDate,
                        deptId,
                        totalTopics,
                        passedTopics,
                        totalVoters,
                        Math.round(participationRate * 100) / 100,
                        Math.round(passRate * 100) / 100,
                        Math.round(avgVotes * 100) / 100,
                      ],
                      (err) => {
                        if (err) {
                          pending = -1;
                          return reject(err);
                        }
                        pending--;
                        if (pending === 0) resolve({ date: statDate, departments_processed: departments.length });
                      }
                    );
                  }
                );
              }
            );
          }
        );
      });
    });
  });
};

const getStatistics = (req, res) => {
  const { start_date, end_date, department_id } = req.query;
  const startDate = start_date || dayjs().subtract(30, 'day').format('YYYY-MM-DD');
  const endDate = end_date || dayjs().format('YYYY-MM-DD');

  let whereClause = 'WHERE stat_date >= ? AND stat_date <= ?';
  const params = [startDate, endDate];

  if (department_id) {
    whereClause += ' AND department_id = ?';
    params.push(department_id);
  } else {
    whereClause += ' AND department_id IS NULL';
  }

  const sql = `
    SELECT * FROM daily_statistics
    ${whereClause}
    ORDER BY stat_date ASC
  `;

  db.all(sql, params, (err, stats) => {
    if (err) return res.status(500).json({ error: '数据库错误' });

    const summary = stats.length > 0
      ? {
          total_topics: stats.reduce((sum, s) => sum + s.total_topics, 0),
          total_passed: stats.reduce((sum, s) => sum + s.passed_topics, 0),
          avg_participation_rate: Math.round(
            stats.reduce((sum, s) => sum + s.participation_rate, 0) / stats.length
          ),
          avg_pass_rate: Math.round(
            stats.reduce((sum, s) => sum + s.pass_rate, 0) / stats.length
          ),
          avg_votes: Math.round(
            stats.reduce((sum, s) => sum + s.avg_votes, 0) / stats.length
          ),
        }
      : { total_topics: 0, total_passed: 0, avg_participation_rate: 0, avg_pass_rate: 0, avg_votes: 0 };

    res.json({
      summary,
      daily_data: stats,
      start_date: startDate,
      end_date: endDate,
    });
  });
};

const getDepartmentStatistics = (req, res) => {
  const { date } = req.query;
  const statDate = date || dayjs().format('YYYY-MM-DD');

  db.all(
    `SELECT s.*, d.name as department_name
     FROM daily_statistics s
     LEFT JOIN departments d ON s.department_id = d.id
     WHERE s.stat_date = ? AND s.department_id IS NOT NULL
     ORDER BY s.participation_rate DESC`,
    [statDate],
    (err, stats) => {
      if (err) return res.status(500).json({ error: '数据库错误' });
      res.json({ date: statDate, departments: stats });
    }
  );
};

const exportExcelReport = (req, res) => {
  const { start_date, end_date, department_id } = req.query;
  const startDate = start_date || dayjs().subtract(30, 'day').format('YYYY-MM-DD');
  const endDate = end_date || dayjs().format('YYYY-MM-DD');

  let whereClause = 'WHERE stat_date >= ? AND stat_date <= ?';
  const params = [startDate, endDate];

  if (department_id) {
    whereClause += ' AND department_id = ?';
    params.push(department_id);
  } else {
    whereClause += ' AND department_id IS NULL';
  }

  db.all(
    `SELECT * FROM daily_statistics ${whereClause} ORDER BY stat_date ASC`,
    params,
    async (err, stats) => {
      if (err) return res.status(500).json({ error: '导出失败' });

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('投票统计');

      worksheet.columns = [
        { header: '日期', key: 'stat_date', width: 15 },
        { header: '议题总数', key: 'total_topics', width: 12 },
        { header: '通过议题数', key: 'passed_topics', width: 12 },
        { header: '投票人数', key: 'total_voters', width: 12 },
        { header: '参与率(%)', key: 'participation_rate', width: 12 },
        { header: '通过率(%)', key: 'pass_rate', width: 12 },
        { header: '平均票数', key: 'avg_votes', width: 12 },
      ];

      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' },
      };

      stats.forEach((stat) => worksheet.addRow(stat));

      const chartSheet = workbook.addWorksheet('趋势图表');
      chartSheet.addRow(['日期', '参与率(%)', '通过率(%)']);
      chartSheet.getRow(1).font = { bold: true };

      stats.forEach((stat) => {
        chartSheet.addRow([stat.stat_date, stat.participation_rate, stat.pass_rate]);
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="voting_report_${dayjs().format('YYYYMMDD')}.xlsx"`
      );

      await workbook.xlsx.write(res);
      res.end();
    }
  );
};

const exportPdfReport = (req, res) => {
  const { start_date, end_date, department_id } = req.query;
  const startDate = start_date || dayjs().subtract(30, 'day').format('YYYY-MM-DD');
  const endDate = end_date || dayjs().format('YYYY-MM-DD');

  let whereClause = 'WHERE stat_date >= ? AND stat_date <= ?';
  const params = [startDate, endDate];

  if (department_id) {
    whereClause += ' AND department_id = ?';
    params.push(department_id);
  } else {
    whereClause += ' AND department_id IS NULL';
  }

  db.all(
    `SELECT * FROM daily_statistics ${whereClause} ORDER BY stat_date ASC`,
    params,
    (err, stats) => {
      if (err) return res.status(500).json({ error: '导出失败' });

      const doc = new PDFDocument({ size: 'A4', margin: 50 });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="voting_report_${dayjs().format('YYYYMMDD')}.pdf"`
      );

      doc.pipe(res);

      doc.fontSize(20).text('投票系统统计报告', { align: 'center' });
      doc.moveDown();

      doc.fontSize(12).text(`报告周期：${startDate} 至 ${endDate}`);
      doc.moveDown();

      if (stats.length > 0) {
        const summary = {
          totalTopics: stats.reduce((sum, s) => sum + s.total_topics, 0),
          totalPassed: stats.reduce((sum, s) => sum + s.passed_topics, 0),
          avgParticipation: Math.round(
            stats.reduce((sum, s) => sum + s.participation_rate, 0) / stats.length
          ),
          avgPassRate: Math.round(
            stats.reduce((sum, s) => sum + s.pass_rate, 0) / stats.length
          ),
          avgVotes: Math.round(
            stats.reduce((sum, s) => sum + s.avg_votes, 0) / stats.length
          ),
        };

        doc.fontSize(16).text('汇总数据', { underline: true });
        doc.moveDown();
        doc.fontSize(12);
        doc.text(`总议题数：${summary.totalTopics}`);
        doc.text(`通过议题数：${summary.totalPassed}`);
        doc.text(`平均参与率：${summary.avgParticipation}%`);
        doc.text(`平均通过率：${summary.avgPassRate}%`);
        doc.text(`平均票数：${summary.avgVotes}`);
        doc.moveDown();

        doc.fontSize(16).text('每日明细', { underline: true });
        doc.moveDown();

        const tableTop = doc.y;
        const colWidths = [80, 60, 60, 60, 60, 60, 60];
        const headers = ['日期', '议题数', '通过数', '投票人数', '参与率', '通过率', '平均票数'];

        doc.fontSize(10);
        let x = 50;
        headers.forEach((header, i) => {
          doc.text(header, x, tableTop, { width: colWidths[i], align: 'center' });
          x += colWidths[i];
        });

        let y = tableTop + 20;
        stats.slice(0, 20).forEach((stat) => {
          x = 50;
          doc.text(stat.stat_date, x, y, { width: colWidths[0] });
          doc.text(String(stat.total_topics), x + colWidths[0], y, { width: colWidths[1], align: 'center' });
          doc.text(String(stat.passed_topics), x + colWidths[0] + colWidths[1], y, { width: colWidths[2], align: 'center' });
          doc.text(String(stat.total_voters), x + colWidths[0] + colWidths[1] + colWidths[2], y, { width: colWidths[3], align: 'center' });
          doc.text(stat.participation_rate + '%', x + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], y, { width: colWidths[4], align: 'center' });
          doc.text(stat.pass_rate + '%', x + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], y, { width: colWidths[5], align: 'center' });
          doc.text(String(stat.avg_votes), x + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + colWidths[5], y, { width: colWidths[6], align: 'center' });
          y += 18;
        });
      } else {
        doc.fontSize(12).text('暂无统计数据');
      }

      doc.moveDown();
      doc.fontSize(10).text(`生成时间：${dayjs().format('YYYY-MM-DD HH:mm:ss')}`, { align: 'right' });

      doc.end();
    }
  );
};

module.exports = {
  calculateDailyStatistics,
  getStatistics,
  getDepartmentStatistics,
  exportExcelReport,
  exportPdfReport,
};
