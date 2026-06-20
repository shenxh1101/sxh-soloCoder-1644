const http = require('http');
function rq(p,m,d,t){return new Promise((rs,rj)=>{
  const pd=d?JSON.stringify(d):null;
  const o={hostname:'127.0.0.1',port:3000,path:'/api'+p,method:m,headers:{'Content-Type':'application/json'}};
  if(t)o.headers.Authorization='Bearer '+t;
  if(pd)o.headers['Content-Length']=Buffer.byteLength(pd);
  const r=http.request(o,res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>{
    if(res.statusCode>=200&&res.statusCode<300){try{rs(JSON.parse(b))}catch(e){rs(b)}}
    else{console.log(`[${m} ${p}] FAIL HTTP ${res.statusCode}`);console.log('  '+b.slice(0,500));rj(new Error('HTTP '+res.statusCode+': '+b.slice(0,200)))}
  })});
  r.on('error',rj);if(pd)r.write(pd);r.end();
});}

async function main(){
  try{
    const admin=(await rq('/auth/login','POST',{username:'admin',password:'admin123'})).token;
    const tech=(await rq('/auth/login','POST',{username:'tech_manager',password:'123456'})).token;
    const emp1=(await rq('/auth/login','POST',{username:'employee1',password:'123456'})).token;
    const emp2=(await rq('/auth/login','POST',{username:'employee2',password:'123456'})).token;
    const emp3=(await rq('/auth/login','POST',{username:'employee3',password:'123456'})).token;
    const depts=await rq('/departments','GET',null,admin);
    const deptTech=depts.find(d=>d.name==='技术部').id;
    console.log('技术部ID:',deptTech);

    console.log('\n--- 1.创建议题 ---');
    const t1=await rq('/topics','POST',{title:'测试1',department_id:deptTech,options:['A','B'],deadline:new Date(Date.now()+86400000).toISOString()},admin);
    console.log('  创建OK, id=',t1.id,'options=',JSON.stringify(t1.options));

    console.log('\n--- 2.议题审核 ---');
    const rv=await rq('/topics/'+t1.id+'/review','POST',{action:'approve'},tech);
    console.log('  审核OK:',JSON.stringify(rv).slice(0,200));

    console.log('\n--- 3.投票 ---');
    for (const [i,tk] of [[1,emp1],[2,emp2],[3,emp3]].entries()) {
      const v=await rq('/votes','POST',{topic_id:t1.id,option_id:t1.options[0].id},tk);
      console.log('  员工'+(i+1)+'投票OK:',JSON.stringify(v).slice(0,150));
    }

    console.log('\n--- 4.结票 ---');
    const f=await rq('/results/'+t1.id+'/finalize','POST',null,admin);
    console.log('  结票OK:',JSON.stringify(f).slice(0,400));

    console.log('\n--- 5.决议审批（生成任务） ---');
    const ap=await rq('/results/resolutions/'+f.resolutionId+'/approve','POST',{},admin);
    console.log('  决议审批OK:',JSON.stringify(ap).slice(0,400));

  }catch(e){console.log('\n❌ 失败:',e.message||e.stack);}
}
main();
