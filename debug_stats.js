const http = require('http');
const baseUrl = '127.0.0.1', port = 3000;

function req(p, m='GET', d, t) {
  return new Promise((resolve, reject) => {
    const pd = d ? JSON.stringify(d) : null;
    const o = {hostname: baseUrl, port, path: '/api'+p, method: m,
      headers: {'Content-Type':'application/json'}};
    if (t) o.headers.Authorization = 'Bearer '+t;
    if (pd) o.headers['Content-Length'] = Buffer.byteLength(pd);
    const rq = http.request(o, (res) => {
      let b=''; res.on('data',c=>b+=c); res.on('end',()=>{
        try { res.statusCode>=200&&res.statusCode<300?resolve(JSON.parse(b)):reject({s:res.statusCode,e:JSON.parse(b)});}
        catch{resolve(b);}});});
    rq.on('error',reject); if (pd) rq.write(pd); rq.end();
  });
}

(async ()=>{
  const admin = await req('/auth/login','POST',{username:'admin',password:'admin123'});
  console.log('token:', admin.token? 'OK':'FAIL');
  await req('/statistics/trigger?days=7','POST',null,admin.token);
  const ds = await req('/statistics/departments','GET',null,admin.token);
  console.log('\n=== 部门统计接口返回 ===');
  console.log('顶层字段:', Object.keys(ds));
  console.log('date:', ds.date);
  console.log('departments数量:', ds.departments?ds.departments.length:'undefined');
  if (ds.departments) ds.departments.forEach(d=>console.log(' ', d.department_name, 'topics:',d.total_topics,'part%:',d.participation_rate));
  console.log('\n=== 数据库中实际存在的department级统计 ===');
  const srv = require('./src/config/database');
  srv.all('SELECT stat_date, COUNT(*) as cnt, GROUP_CONCAT(department_id) depts FROM daily_statistics GROUP BY stat_date ORDER BY stat_date DESC LIMIT 10', (e,r)=>{
    if(e)console.log('DB err',e); else r.forEach(x=>console.log(' ', x.stat_date, '记录数:', x.cnt, '部门IDs:', x.depts));
  });
})().catch(e=>console.log('ERROR',e));
