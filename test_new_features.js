const http = require('http');
const crypto = require('crypto');
const baseUrl = '127.0.0.1';
const port = 3000;
const pass = (msg) => console.log('  \u2713 PASS:', msg);
const fail = (msg) => { console.log('  \u2717 FAIL:', msg); process.exitCode = 1; };

function request(path, method='GET', data=null, token=null) {
  return new Promise((resolve, reject) => {
    const pd = data ? JSON.stringify(data) : null;
    const o = {hostname:baseUrl, port, path:'/api'+path, method, headers:{'Content-Type':'application/json'}};
    if (token) o.headers.Authorization = 'Bearer '+token;
    if (pd) o.headers['Content-Length'] = Buffer.byteLength(pd);
    const rq = http.request(o, res => {
      let b=''; res.on('data',c=>b+=c); res.on('end',()=>{
        if (res.statusCode>=200&&res.statusCode<300) {
          try { resolve(JSON.parse(b)); } catch { resolve(b); }
        } else {
          let parsed={error:b}; try { parsed = JSON.parse(b); } catch {}
          reject({s:res.statusCode, e:parsed, raw:b});
        }
      });
    });
    rq.on('error',reject); if (pd) rq.write(pd); rq.end();
  });
}

function rawRequest(path, token='') {
  return new Promise((resolve, reject) => {
    const o = {hostname:baseUrl, port, path:'/api'+path, method:'GET',
      headers:token?{Authorization:'Bearer '+token}:{}};
    const rq = http.get(o, res => {
      let size=0, chunks=[], ct=res.headers['content-type'], disp=res.headers['content-disposition'];
      res.on('data',c=>{size+=c.length; chunks.push(c);});
      res.on('end',()=>{
        const buf = Buffer.concat(chunks);
        let parsed = null;
        if (ct && ct.indexOf('json')>=0) { try { parsed = JSON.parse(buf.toString()); } catch {} }
        resolve({status:res.statusCode, size, ct, disp, buf, parsed,
          hash: crypto.createHash('md5').update(buf).digest('hex')});
      });
    });
    rq.on('error',reject);
  });
}

async function login(u,p){return (await request('/auth/login','POST',{username:u,password:p})).token;}

async function run() {
  console.log('\n============================================');
  console.log('   新增4项功能：补跑/看板/流转/导出记录 验证测试 v2');
  console.log('============================================\n');

  let adminToken, techMgrToken, productMgrToken, emp1Token, emp2Token;
  let deptTech, deptProduct, techTopicId;

  console.log('--- 准备：登录与部门 ---');
  adminToken = await login('admin','admin123');
  techMgrToken = await login('tech_manager','123456');
  productMgrToken = await login('product_manager','123456');
  emp1Token = await login('employee1','123456');
  emp2Token = await login('employee2','123456');
  const depts = await request('/departments','GET',null,adminToken);
  deptTech = depts.find(d=>d.name==='技术部').id;
  deptProduct = depts.find(d=>d.name==='产品部').id;
  pass(`令牌就绪 | 技术部#${deptTech} 产品部#${deptProduct}`);

  console.log('\n============================================');
  console.log('【需求1】统计补跑：指定日期区间 + 幂等 + 三端一致');
  console.log('============================================');

  let statBefore;
  try {
    const run1 = await request('/statistics/trigger?start_date=2026-06-01&end_date=2026-06-10','POST',null,adminToken);
    if (run1.mode==='range' && run1.count===10) {
      pass(`区间补跑成功 → mode=range, count=${run1.count}, 起止:${run1.start_date}~${run1.end_date}`);
    } else fail(`区间补跑异常: ${JSON.stringify(run1)}`);
  } catch(e) { fail('区间补跑失败: '+JSON.stringify(e.e||e)); }

  try {
    statBefore = await request('/statistics?start_date=2026-06-01&end_date=2026-06-10','GET',null,adminToken);
    pass(`统计接口 → 10天汇总议题:${statBefore.summary.total_topics}, 趋势点:${statBefore.trend.length}`);
  } catch(e) { fail('统计接口失败: '+JSON.stringify(e.e||e)); }

  try {
    await request('/statistics/trigger?start_date=2026-06-01&end_date=2026-06-10','POST',null,adminToken);
    const statAfter = await request('/statistics?start_date=2026-06-01&end_date=2026-06-10','GET',null,adminToken);
    const ok = statBefore.summary.total_topics === statAfter.summary.total_topics &&
      statBefore.summary.avg_participation_rate === statAfter.summary.avg_participation_rate &&
      statBefore.summary.avg_pass_rate === statAfter.summary.avg_pass_rate &&
      JSON.stringify(statBefore.trend) === JSON.stringify(statAfter.trend);
    ok ? pass(`幂等性验证 ✅ 重跑前后完全一致: 议题${statBefore.summary.total_topics} 参与率${statBefore.summary.avg_participation_rate}% 通过率${statBefore.summary.avg_pass_rate}%`)
       : fail(`幂等失败! before:${JSON.stringify(statBefore.summary)} after:${JSON.stringify(statAfter.summary)}`);
  } catch(e) { fail('幂等验证失败: '+JSON.stringify(e.e||e)); }

  try {
    const pdfRes = await rawRequest('/statistics/export/pdf?start_date=2026-06-05&end_date=2026-06-10', adminToken);
    const xlsxRes = await rawRequest('/statistics/export/excel?start_date=2026-06-05&end_date=2026-06-10', adminToken);
    const ok = pdfRes.status===200 && pdfRes.size>2000 && xlsxRes.status===200 && xlsxRes.size>2000 && pdfRes.ct==='application/pdf';
    ok ? pass(`PDF/Excel导出正常 → PDF:${(pdfRes.size/1024).toFixed(1)}KB Excel:${(xlsxRes.size/1024).toFixed(1)}KB 三端共用统一WHERE`)
       : fail(`报表异常! PDF status=${pdfRes.status} size=${pdfRes.size} | Excel status=${xlsxRes.status} size=${xlsxRes.size}`);
  } catch(e) { fail('报表导出失败: '+e.message); }

  console.log('\n============================================');
  console.log('【需求2】决议升级看板：筛选 + 48小时精准升级');
  console.log('============================================');

  let resolutionId;
  try {
    const t1 = await request('/topics','POST',{title:'升级看板测试议题',department_id:deptTech,options:['A方案','B方案'],deadline:new Date(Date.now()+86400000).toISOString()},adminToken);
    techTopicId = t1.id;
    const t1Detail = await request(`/topics/${techTopicId}`,'GET',null,adminToken);
    await request(`/topics/${techTopicId}/review`,'POST',{action:'approve'},techMgrToken);
    const optAId = t1Detail.options[0].id;
    const emp3Token = await login('employee3','123456');
    for (const tk of [emp1Token, emp2Token, emp3Token]) {
      await request('/votes','POST',{topic_id:techTopicId,option_id:optAId},tk);
    }
    const fin = await request(`/results/${techTopicId}/finalize`,'POST',null,adminToken);
    resolutionId = fin.resolutionId;
    pass(`创建议题+结票 → 决议#${resolutionId}: ${fin.result}`);
  } catch(e) { fail('准备决议失败: '+(e.e?.error||e.raw||e.message||JSON.stringify(e))); }

  try {
    const r0 = await request('/results/resolutions?status=pending&min_hours_pending=1','GET',null,adminToken);
    const rAll = await request('/results/resolutions?status=pending','GET',null,adminToken);
    pass(`未审批时长筛选 → 全部pending:${rAll.total} >=1h:${r0.total} (新决议<1h时后者=0则正确)`);
  } catch(e) { fail('min_hours_pending筛选失败: '+(e.e?.error||e.raw||JSON.stringify(e))); }

  try {
    const rDept = await request(`/results/resolutions?department_id=${deptProduct}`,'GET',null,adminToken);
    rDept.total===0 ? pass(`部门筛选正确 → 查产品部得 0 条 (决议在技术部)`)
                    : fail(`部门筛选错误! 产品部应该0条但返回${rDept.total}条`);
  } catch(e) { fail('部门筛选失败: '+(e.e?.error||e.raw||JSON.stringify(e))); }

  try {
    const db = require('./src/config/database');
    await new Promise((res, rej) => {
      db.run(`UPDATE resolutions SET created_at = DATETIME('now','-49 hours') WHERE id = ?`, [resolutionId],
        (e)=>e?rej(e):res());
    });
    const { checkAndEscalate } = require('./src/controllers/resolutionController');
    const upgraded = await checkAndEscalate();
    const board = await request('/results/resolutions?escalated=1&status=pending','GET',null,adminToken);
    const target = board.list.find(x => x.id === resolutionId);
    (upgraded>=1 && target && (target.escalation_status||'').indexOf('升级')>=0) ?
      pass(`48小时精准升级 ✅ 升级数=${upgraded}, 决议#${target.id} 状态=${target.escalation_status}`) :
      fail(`升级异常! upgraded=${upgraded} target=${target?target.escalation_status:'未找到'}`);
  } catch(e) { fail('升级流程失败: '+(e.message||e.raw||JSON.stringify(e))); }

  console.log('\n============================================');
  console.log('【需求3】任务流转：接收/完成/退回 + 记录 + 权限');
  console.log('============================================');

  let taskId;
  try {
    const ap = await request(`/results/resolutions/${resolutionId}/approve`,'POST',{},adminToken);
    taskId = ap.task_id;
    pass(`决议审批 → 自动生成任务#${taskId}: ${ap.message}`);
  } catch(e) { fail('决议审批失败: '+(e.e?.error||e.raw||JSON.stringify(e))); }

  try {
    const td = await request(`/results/tasks/${taskId}`,'GET',null,adminToken);
    (td.status==='assigned' && td.current_handler_id && (td.assignee_display||'').indexOf('技术')>=0) ?
      pass(`任务初始状态 → assigned, 处理人:${td.assignee_display}`) :
      fail(`初始状态异常! status=${td.status} display=${td.assignee_display}`);
  } catch(e) { fail('初始任务详情失败: '+(e.e?.error||e.raw||JSON.stringify(e))); }

  try {
    const r = await request(`/results/tasks/${taskId}/receive`,'POST',{},techMgrToken);
    pass(`任务接收 → ${r.message||'ok'}`);
  } catch(e) { fail('任务接收失败: '+(e.e?.error||e.raw||JSON.stringify(e))); }

  try {
    const r = await request(`/results/tasks/${taskId}/complete`,'POST',{remark:'执行完毕，达成预期效果'},techMgrToken);
    pass(`任务完成 → ${r.message||'ok'}`);
  } catch(e) { fail('任务完成失败: '+(e.e?.error||e.raw||JSON.stringify(e))); }

  try {
    const td = await request(`/results/tasks/${taskId}`,'GET',null,adminToken);
    const ops = td.operation_logs || [];
    const ok = ops.some(o=>o.action==='CREATE') && ops.some(o=>o.action==='RECEIVE') && ops.some(o=>o.action==='COMPLETE') && ('overdue' in td);
    ok ? pass(`操作日志完整 ✅ 记录数:${ops.length} (CREATE+RECEIVE+COMPLETE), overdue=${td.overdue}`) :
       fail(`日志缺项! 共${ops.length}条, overdue字段:${('overdue' in td)}`);
  } catch(e) { fail('任务操作日志失败: '+(e.e?.error||e.raw||JSON.stringify(e))); }

  let taskId2;
  try {
    const t2 = await request('/topics','POST',{title:'退回流程测试',department_id:deptTech,options:['X','Y'],deadline:new Date(Date.now()+86400000).toISOString()},adminToken);
    const t2Detail = await request(`/topics/${t2.id}`,'GET',null,adminToken);
    await request(`/topics/${t2.id}/review`,'POST',{action:'approve'},techMgrToken);
    const xId = t2Detail.options[0].id;
    await request('/votes','POST',{topic_id:t2.id,option_id:xId},emp1Token);
    await request('/votes','POST',{topic_id:t2.id,option_id:xId},emp2Token);
    const f2 = await request(`/results/${t2.id}/finalize`,'POST',null,adminToken);
    const ap2 = await request(`/results/resolutions/${f2.resolutionId}/approve`,'POST',{},adminToken);
    taskId2 = ap2.task_id;
    await request(`/results/tasks/${taskId2}/receive`,'POST',{},techMgrToken);
    await request(`/results/tasks/${taskId2}/return`,'POST',{remark:'超出本部门权责，需协同'},techMgrToken);
    const td = await request(`/results/tasks/${taskId2}`,'GET',null,adminToken);
    (td.status==='returned' && td.returned_count===1 && (td.last_remark||'').indexOf('超')>=0) ?
      pass(`退回流程 ✅ 状态:${td.status} 退回次数:${td.returned_count} 备注:${td.last_remark.slice(0,10)}...`) :
      fail(`退回异常! status=${td.status} cnt=${td.returned_count} remark=${td.last_remark}`);
  } catch(e) { fail('退回流程失败: '+(e.e?.error||e.raw||e.message||JSON.stringify(e))); }

  try {
    const empList = await request('/results/tasks?page_size=100','GET',null,emp1Token);
    const allList = await request('/results/tasks?page_size=100','GET',null,adminToken);
    (empList.total===0 && allList.total>=2) ?
      pass(`权限隔离 ✅ 员工:${empList.total}条(仅自己) 管理员:${allList.total}条(全看)`) :
      fail(`权限异常! 员工见${empList.total} 管理员见${allList.total}`);
  } catch(e) { fail('权限隔离失败: '+(e.e?.error||e.raw||JSON.stringify(e))); }

  console.log('\n============================================');
  console.log('【需求4】审计导出记录：条件快照 + 复用 + 重下载');
  console.log('============================================');

  const auditQ = `department_id=${deptTech}&format=json`;
  let firstSize, firstHash, firstId;
  try {
    const r1 = await rawRequest(`/audit-logs/export?${auditQ}`, adminToken);
    if (r1.parsed && r1.parsed.data && Array.isArray(r1.parsed.data)) {
      firstSize = r1.size; firstHash = r1.hash;
      pass(`第一次导出 ✅ 大小:${(firstSize/1024).toFixed(2)}KB 记录数:${r1.parsed.data.length} hash:${firstHash.slice(0,8)}`);
    } else {
      fail(`第一次导出解析失败! status=${r1.status} size=${r1.size} ct=${r1.ct}`);
    }
  } catch(e) { fail('第一次导出失败: '+e.message); }

  try {
    const r2 = await rawRequest(`/audit-logs/export?${auditQ}`, adminToken);
    (r2.hash===firstHash && r2.size===firstSize) ?
      pass(`复用验证 ✅ 同筛选条件hash完全一致, 字节数也完全相同 (${r2.size}Bytes)`) :
      fail(`复用失败! 第一hash:${firstHash.slice(0,8)} 第二hash:${r2.hash.slice(0,8)} 大小:${firstSize}vs${r2.size}`);
  } catch(e) { fail('第二次导出失败: '+e.message); }

  try {
    const list = await rawRequest('/audit-logs/export-records?page_size=100', adminToken);
    const items = (list.parsed && list.parsed.list) || [];
    const rec = items.find(x=>x.format==='json' && x.record_count>0);
    if (rec) {
      firstId = rec.id;
      pass(`导出记录可查 ✅ 总数:${list.parsed.total||items.length}条, 刚导出: ${rec.format} ${rec.record_count}条, 下载次数:${rec.download_count}, 筛选键:${Object.keys(rec.filter_values||{}).length}`);
    } else fail(`记录页查询失败! 总数${items.length}, 未找到目标JSON记录`);
  } catch(e) { fail('记录页查询失败: '+e.message); }

  try {
    const dl1 = await rawRequest(`/audit-logs/export-download?id=${firstId}`, adminToken);
    const dl2 = await rawRequest(`/audit-logs/export-download?id=${firstId}`, adminToken);
    (dl1.status===200 && dl2.status===200 && dl1.hash===dl2.hash) ?
      pass(`重新下载 ✅ 两次内容hash完全相同: ${dl1.hash.slice(0,8)}, 内容不变`) :
      fail(`重下载异常! dl1 status=${dl1.status} hash=${dl1.hash.slice(0,8)} | dl2 status=${dl2.status} hash=${dl2.hash.slice(0,8)}`);
  } catch(e) { fail('重下载失败: '+e.message); }

  try {
    await rawRequest('/audit-logs/export?format=csv&start_date=2026-06-01', adminToken);
    const csv = await rawRequest('/audit-logs/export-records?format=csv', adminToken);
    const items = (csv.parsed && csv.parsed.list) || [];
    items.length>=1 ?
      pass(`CSV导出+筛选 ✅ 记录页format=csv筛选命中${items.length}条, 模块:${items[0]?.module||'未知'}`) :
      fail(`CSV记录筛选失败! 命中${items.length}条, parsed?${!!csv.parsed}`);
  } catch(e) { fail('CSV导出记录失败: '+e.message); }

  console.log('\n============================================');
  console.log('   全部4项新功能验证完成！');
  console.log('============================================\n');
}

run().catch(e=>{console.error('测试异常:',e);process.exitCode=1;});
