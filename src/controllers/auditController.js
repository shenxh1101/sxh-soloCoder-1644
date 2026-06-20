const db = require('../config/database');
const dayjs = require('dayjs');
const crypto = require('crypto');

const buildStableHash = (obj) => {
  const sorted = {};
  Object.keys(obj).sort().forEach((key) => {
    if (obj[key] !== undefined && obj[key] !== null) {
      sorted[key] = typeof obj[key] === 'object' ? buildStableHash(obj[key]) : obj[key];
    }
  });
  return crypto.createHash('md5').update(JSON.stringify(sorted)).digest('hex');
};

const buildFilterWhereClause = (query) => {
  const {
    topic_id,
    topic_name,
    department_id,
    user_id,
    action,
    module,
    start_date,
    end_date,
    keyword,
  } = query;

  let whereClause = 'WHERE 1=1';
  const params = [];
  const joins = [];
  const filters = { applied: [], values: {} };

  if (topic_id) {
    whereClause += ' AND l.topic_id = ?';
    params.push(topic_id);
    filters.applied.push('topic_id');
    filters.values.topic_id = topic_id;
  }

  if (topic_name) {
    joins.push(`LEFT JOIN topics t_join ON l.topic_id = t_join.id`);
    whereClause += ' AND t_join.title LIKE ?';
    params.push(`%${topic_name}%`);
    filters.applied.push('topic_name');
    filters.values.topic_name = topic_name;
  }

  if (department_id) {
    joins.push(`LEFT JOIN topics t_dept ON l.topic_id = t_dept.id`);
    whereClause += ' AND t_dept.department_id = ?';
    params.push(department_id);
    filters.applied.push('department_id');
    filters.values.department_id = department_id;
  }

  if (user_id) {
    whereClause += ' AND l.user_id = ?';
    params.push(user_id);
    filters.applied.push('user_id');
    filters.values.user_id = user_id;
  }

  if (action) {
    whereClause += ' AND l.action = ?';
    params.push(action);
    filters.applied.push('action');
    filters.values.action = action;
  }

  if (module) {
    whereClause += ' AND l.module = ?';
    params.push(module);
    filters.applied.push('module');
    filters.values.module = module;
  }

  if (start_date) {
    whereClause += ' AND l.created_at >= ?';
    params.push(start_date);
    filters.applied.push('start_date');
    filters.values.start_date = start_date;
  }

  if (end_date) {
    whereClause += ' AND l.created_at <= ?';
    params.push(end_date + ' 23:59:59');
    filters.applied.push('end_date');
    filters.values.end_date = end_date;
  }

  if (keyword) {
    whereClause += ' AND (l.details LIKE ? OR l.action LIKE ? OR l.module LIKE ? OR u.username LIKE ? OR u.real_name LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    filters.applied.push('keyword');
    filters.values.keyword = keyword;
  }

  return { whereClause, params, joins, filters };
};

const getAuditLogs = (req, res) => {
  const { page = 1, page_size = 20, ...queryParams } = req.query;
  const offset = (page - 1) * page_size;

  const { whereClause, params, joins, filters } = buildFilterWhereClause(queryParams);
  const joinSql = joins.length > 0 ? joins.join(' ') : '';

  const countSql = `
    SELECT COUNT(*) as total 
    FROM audit_logs l
    LEFT JOIN users u ON l.user_id = u.id
    ${joinSql}
    ${whereClause}
  `;

  const listSql = `
    SELECT l.*, 
           u.real_name as user_name,
           u.username,
           t.title as topic_title,
           d.name as topic_department_name,
           d.id as topic_department_id
    FROM audit_logs l
    LEFT JOIN users u ON l.user_id = u.id
    LEFT JOIN topics t ON l.topic_id = t.id
    LEFT JOIN departments d ON t.department_id = d.id
    ${joins.length > 0 ? joins.join(' ') : ''}
    ${whereClause}
    GROUP BY l.id
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT ? OFFSET ?
  `;

  const countParams = [...params];
  const listParams = [...params, parseInt(page_size), offset];

  db.get(countSql, countParams, (err, countResult) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: '数据库错误' });
    }

    db.all(listSql, listParams, (err, logs) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: '数据库错误' });
      }

      const summary = {
        total_records: countResult.total,
        current_page: parseInt(page),
        page_size: parseInt(page_size),
        total_pages: Math.ceil(countResult.total / page_size),
        filters_applied: filters.applied,
        filter_values: filters.values,
        matched_actions: {},
      };

      if (logs.length > 0) {
        const actionSet = new Set(logs.map((l) => l.action));
        actionSet.forEach((a) => {
          summary.matched_actions[a] = logs.filter((l) => l.action === a).length;
        });
      }

      res.json({
        summary,
        list: logs,
        total: countResult.total,
        page: parseInt(page),
        page_size: parseInt(page_size),
      });
    });
  });
};

const getAuditLogFilters = (req, res) => {
  const result = {
    actions: [],
    modules: [],
    departments: [],
    date_range: {
      min: null,
      max: null,
    },
  };

  db.all(
    `SELECT DISTINCT action FROM audit_logs ORDER BY action`,
    [],
    (err, actions) => {
      if (!err) result.actions = actions.map((a) => a.action);

      db.all(
        `SELECT DISTINCT module FROM audit_logs ORDER BY module`,
        [],
        (err, modules) => {
          if (!err) result.modules = modules.map((m) => m.module);

          db.all(
            `SELECT id, name FROM departments ORDER BY name`,
            [],
            (err, depts) => {
              if (!err) result.departments = depts;

              db.get(
                `SELECT MIN(created_at) as min_date, MAX(created_at) as max_date FROM audit_logs`,
                [],
                (err, dates) => {
                  if (!err && dates) {
                    result.date_range.min = dates.min_date;
                    result.date_range.max = dates.max_date;
                  }
                  res.json(result);
                }
              );
            }
          );
        }
      );
    }
  );
};

const generateExportContent = (logs, format, filters, queryParams) => {
  return new Promise((resolve, reject) => {
    const exportMeta = {
      exported_at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      total_count: logs.length,
      filters: filters.applied,
      filter_values: filters.values,
      date_range: {
        start: queryParams.start_date || '无限制',
        end: queryParams.end_date || '无限制',
      },
    };

    const actionNames = {
      login_success: '登录成功',
      login_failed: '登录失败',
      user_register: '用户注册',
      create_topic: '创建议题',
      approve_topic: '审核通过议题',
      reject_topic: '审核驳回议题',
      vote_cast: '投票成功',
      vote_rejected: '投票被拒绝',
      finalize_vote: '结票',
      approve_resolution: '通过决议',
      reject_resolution: '驳回决议',
      escalate_resolution: '决议升级',
      create_task: '创建任务',
      assign_task: '分配任务',
      recount_votes: '重新计票',
      create_department: '创建部门',
      update_department: '更新部门',
      delete_department: '删除部门',
    };

    const moduleNames = {
      auth: '认证',
      user: '用户',
      topic: '议题',
      vote: '投票',
      resolution: '决议',
      task: '任务',
      department: '部门',
    };

    if (format === 'csv') {
      const headers = [
        'ID',
        '操作',
        '模块',
        '操作人ID',
        '操作人用户名',
        '操作人姓名',
        '操作人角色',
        '议题ID',
        '议题名称',
        '议题所属部门',
        'IP地址',
        '详情',
        '操作时间',
      ];

      const rows = logs.map((log) => [
        log.id,
        actionNames[log.action] || log.action,
        moduleNames[log.module] || log.module,
        log.user_id || '',
        log.username || '',
        log.user_name || '',
        log.user_role || '',
        log.topic_id || '',
        (log.topic_title || '').replace(/"/g, '""'),
        log.topic_department_name || '',
        log.ip_address || '',
        (log.details || '').replace(/"/g, '""'),
        log.created_at,
      ]);

      const csvContent = [
        headers.join(','),
        ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
      ].join('\n');

      const content = Buffer.from('\uFEFF' + csvContent, 'utf-8');
      const filename = `audit_logs_${dayjs().format('YYYYMMDD_HHmmss')}_${logs.length}_records.csv`;
      const contentType = 'text/csv; charset=utf-8';

      resolve({ content, filename, contentType, exportMeta });
    } else if (format === 'excel') {
      try {
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('审计日志');

        worksheet.columns = [
          { header: 'ID', key: 'id', width: 8 },
          { header: '操作', key: 'action', width: 18 },
          { header: '模块', key: 'module', width: 12 },
          { header: '操作人', key: 'user_name', width: 14 },
          { header: '用户名', key: 'username', width: 14 },
          { header: '角色', key: 'user_role', width: 10 },
          { header: '议题名称', key: 'topic_title', width: 30 },
          { header: '所属部门', key: 'dept_name', width: 14 },
          { header: 'IP地址', key: 'ip_address', width: 15 },
          { header: '操作详情', key: 'details', width: 50 },
          { header: '操作时间', key: 'created_at', width: 20 },
        ];

        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF4472C4' },
        };
        worksheet.getRow(1).font.color = { argb: 'FFFFFFFF' };

        logs.forEach((log, idx) => {
          worksheet.addRow({
            id: log.id,
            action: actionNames[log.action] || log.action,
            module: log.module,
            user_name: log.user_name || '-',
            username: log.username || '-',
            user_role: log.user_role || '-',
            topic_title: log.topic_title || '-',
            dept_name: log.topic_department_name || '-',
            ip_address: log.ip_address || '-',
            details: log.details || '-',
            created_at: log.created_at,
          });
          if (idx % 2 === 1) {
            worksheet.lastRow.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFF5F9FF' },
            };
          }
        });

        const metaSheet = workbook.addWorksheet('筛选条件');
        metaSheet.addRow(['审计日志导出 - 筛选条件说明']);
        metaSheet.mergeCells('A1:D1');
        metaSheet.getCell('A1').font = { size: 14, bold: true };
        metaSheet.addRow([]);
        metaSheet.addRow(['导出时间', exportMeta.exported_at]);
        metaSheet.addRow(['记录总数', exportMeta.total_count]);
        metaSheet.addRow([]);
        metaSheet.addRow(['筛选条件', '筛选值']);
        metaSheet.getRow(5).font = { bold: true };
        metaSheet.getRow(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };

        metaSheet.addRow(['起始日期', exportMeta.date_range.start]);
        metaSheet.addRow(['结束日期', exportMeta.date_range.end]);
        Object.keys(exportMeta.filter_values).forEach((key) => {
          metaSheet.addRow([key, String(exportMeta.filter_values[key])]);
        });

        metaSheet.columns = [{ width: 20 }, { width: 40 }];

        const xlsxName = `audit_logs_${dayjs().format('YYYYMMDD')}_${logs.length}.xlsx`;
        const contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

        workbook.xlsx.writeBuffer().then((buffer) => {
          resolve({
            content: Buffer.from(buffer),
            filename: xlsxName,
            contentType,
            exportMeta,
          });
        }).catch((e) => {
          reject(new Error('Excel生成失败: ' + e.message));
        });
      } catch (excelError) {
        reject(new Error('导出失败: ' + excelError.message));
      }
    } else {
      const jsonContent = JSON.stringify({
        export_info: exportMeta,
        total: logs.length,
        data: logs,
      }, null, 2);

      const content = Buffer.from(jsonContent, 'utf-8');
      const filename = `audit_logs_${dayjs().format('YYYYMMDD_HHmmss')}_${logs.length}_records.json`;
      const contentType = 'application/json; charset=utf-8';

      resolve({ content, filename, contentType, exportMeta });
    }
  });
};

const sendExportResponse = (res, record, content) => {
  res.setHeader('Content-Type', record.content_type || 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${record.content_filename}"; filename*=UTF-8''${encodeURIComponent(record.content_filename)}`
  );
  try {
    res.setHeader('X-Export-Meta', encodeURIComponent(JSON.stringify({
      export_key: record.export_key,
      record_count: record.record_count,
      created_at: record.created_at,
    })));
  } catch (e) { /* ignore header encoding errors */ }
  res.send(content);
};

const updateExportRecordDownload = (recordId) => {
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  db.run(
    `UPDATE export_records SET download_count = download_count + 1, last_downloaded_at = ? WHERE id = ?`,
    [now, recordId],
    (err) => {
      if (err) console.error('更新下载记录失败:', err);
    }
  );
};

const exportAuditLogs = (req, res) => {
  const { format = 'json', page, page_size, ...queryParams } = req.query;
  const module = 'audit';
  const operatorId = req.user ? req.user.id : null;
  const operatorName = req.user ? (req.user.real_name || req.user.username) : null;

  const { filters } = buildFilterWhereClause(queryParams);
  const filterHash = buildStableHash(queryParams);
  const exportKey = `${module}_${format}_${filterHash}`;

  db.get(
    `SELECT * FROM export_records WHERE export_key = ?`,
    [exportKey],
    (err, existingRecord) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: '数据库错误' });
      }

      if (existingRecord && existingRecord.content_snapshot) {
        updateExportRecordDownload(existingRecord.id);
        return sendExportResponse(res, existingRecord, existingRecord.content_snapshot);
      }

      const { whereClause, params, joins } = buildFilterWhereClause(queryParams);
      const baseSelect = `
        SELECT l.id, l.action, l.module, l.user_id, l.topic_id, l.ip_address, l.details, l.created_at,
               u.real_name as user_name,
               u.username,
               u.role as user_role,
               t.title as topic_title,
               d.name as topic_department_name,
               d.id as topic_department_id
        FROM audit_logs l
        LEFT JOIN users u ON l.user_id = u.id
        LEFT JOIN topics t ON l.topic_id = t.id
        LEFT JOIN departments d ON t.department_id = d.id
        ${joins.length > 0 ? joins.join(' ') : ''}
        ${whereClause}
        GROUP BY l.id
      `;

      const orderSql = ` ORDER BY l.created_at DESC, l.id DESC`;
      const listSql = baseSelect + orderSql;

      db.all(listSql, params, async (dbErr, logs) => {
        if (dbErr) {
          console.error(dbErr);
          return res.status(500).json({ error: '导出失败' });
        }

        try {
          const { content, filename, contentType, exportMeta } = await generateExportContent(
            logs,
            format,
            filters,
            queryParams
          );

          const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
          const filterSnapshot = JSON.stringify({
            filter_values: filters.values,
            filters_applied: filters.applied,
            date_range: exportMeta.date_range,
          });

          if (existingRecord) {
            db.run(
              `UPDATE export_records SET 
                content_snapshot = ?, 
                content_filename = ?, 
                content_type = ?,
                record_count = ?, 
                file_size = ?, 
                operator_id = ?, 
                operator_name = ?,
                download_count = download_count + 1,
                last_downloaded_at = ?
              WHERE id = ?`,
              [
                content,
                filename,
                contentType,
                logs.length,
                content.length,
                operatorId,
                operatorName,
                now,
                existingRecord.id,
              ],
              (updateErr) => {
                if (updateErr) console.error('更新导出记录失败:', updateErr);
              }
            );

            const updatedRecord = {
              ...existingRecord,
              content_snapshot: content,
              content_filename: filename,
              content_type: contentType,
            };
            return sendExportResponse(res, updatedRecord, content);
          }

          db.run(
            `INSERT INTO export_records 
              (export_key, module, format, filter_snapshot, filter_hash, record_count, file_size, 
               content_snapshot, content_filename, content_type, operator_id, operator_name, 
               last_downloaded_at, download_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [
              exportKey,
              module,
              format,
              filterSnapshot,
              filterHash,
              logs.length,
              content.length,
              content,
              filename,
              contentType,
              operatorId,
              operatorName,
              now,
            ],
            function (insertErr) {
              if (insertErr) {
                console.error('插入导出记录失败:', insertErr);
              }

              const newRecord = {
                id: this.lastID,
                export_key: exportKey,
                content_filename: filename,
                content_type: contentType,
                record_count: logs.length,
                created_at: now,
              };
              sendExportResponse(res, newRecord, content);
            }
          );
        } catch (exportError) {
          console.error('导出内容生成失败:', exportError);
          res.status(500).json({ error: exportError.message });
        }
      });
    }
  );
};

const getExportRecords = (req, res) => {
  const { page = 1, page_size = 20, module, format, operator_id, start_date, end_date } = req.query;
  const offset = (page - 1) * page_size;

  let whereClause = 'WHERE 1=1';
  const params = [];

  if (module) {
    whereClause += ' AND module = ?';
    params.push(module);
  }

  if (format) {
    whereClause += ' AND format = ?';
    params.push(format);
  }

  if (operator_id) {
    whereClause += ' AND operator_id = ?';
    params.push(operator_id);
  }

  if (start_date) {
    whereClause += ' AND created_at >= ?';
    params.push(start_date);
  }

  if (end_date) {
    whereClause += ' AND created_at <= ?';
    params.push(end_date + ' 23:59:59');
  }

  const countSql = `SELECT COUNT(*) as total FROM export_records ${whereClause}`;
  const listSql = `
    SELECT 
      id,
      export_key,
      module,
      format,
      filter_snapshot,
      filter_hash,
      record_count,
      file_size,
      content_filename,
      content_type,
      operator_id,
      operator_name,
      created_at,
      last_downloaded_at,
      download_count
    FROM export_records
    ${whereClause}
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `;

  const countParams = [...params];
  const listParams = [...params, parseInt(page_size), offset];

  db.get(countSql, countParams, (err, countResult) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: '数据库错误' });
    }

    db.all(listSql, listParams, (listErr, records) => {
      if (listErr) {
        console.error(listErr);
        return res.status(500).json({ error: '数据库错误' });
      }

      const formattedRecords = records.map((r) => {
        let filterSnapshotParsed = null;
        try {
          filterSnapshotParsed = r.filter_snapshot ? JSON.parse(r.filter_snapshot) : null;
        } catch (e) {
          filterSnapshotParsed = r.filter_snapshot;
        }
        return {
          id: r.id,
          export_key: r.export_key,
          module: r.module,
          format: r.format,
          filter_snapshot: filterSnapshotParsed,
          filter_hash: r.filter_hash,
          record_count: r.record_count,
          file_size: r.file_size,
          content_filename: r.content_filename,
          content_type: r.content_type,
          operator_id: r.operator_id,
          operator_name: r.operator_name,
          created_at: r.created_at,
          last_downloaded_at: r.last_downloaded_at,
          download_count: r.download_count,
        };
      });

      res.json({
        summary: {
          total_records: countResult.total,
          current_page: parseInt(page),
          page_size: parseInt(page_size),
          total_pages: Math.ceil(countResult.total / page_size),
        },
        list: formattedRecords,
        total: countResult.total,
        page: parseInt(page),
        page_size: parseInt(page_size),
      });
    });
  });
};

const downloadExportRecord = (req, res) => {
  const { id, export_key } = req.query;

  if (!id && !export_key) {
    return res.status(400).json({ error: '必须提供 id 或 export_key 参数' });
  }

  let sql;
  let params;

  if (id) {
    sql = `SELECT * FROM export_records WHERE id = ?`;
    params = [id];
  } else {
    sql = `SELECT * FROM export_records WHERE export_key = ?`;
    params = [export_key];
  }

  db.get(sql, params, (err, record) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: '数据库错误' });
    }

    if (!record) {
      return res.status(404).json({ error: '导出记录不存在' });
    }

    if (!record.content_snapshot) {
      return res.status(410).json({ error: '导出内容已失效，请重新导出' });
    }

    updateExportRecordDownload(record.id);
    sendExportResponse(res, record, record.content_snapshot);
  });
};

module.exports = {
  getAuditLogs,
  exportAuditLogs,
  getAuditLogFilters,
  getExportRecords,
  downloadExportRecord,
};
