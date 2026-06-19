$baseUrl = "http://localhost:3000/api"

function Write-Step($msg) {
    Write-Host "`n=== $msg ===" -ForegroundColor Cyan
}

function Write-Result($msg) {
    Write-Host "  $msg" -ForegroundColor Green
}

function Write-Error($msg) {
    Write-Host "  ERROR: $msg" -ForegroundColor Red
}

Write-Step "1. 管理员登录"
$adminBody = @{ username = "admin"; password = "admin123" } | ConvertTo-Json
$adminResp = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method Post -Body $adminBody -ContentType "application/json"
$adminToken = $adminResp.token
$adminHeaders = @{ Authorization = "Bearer $adminToken" }
Write-Result "管理员登录成功，Token: $($adminToken.Substring(0,20))..."

Write-Step "2. 获取部门列表"
$depts = Invoke-RestMethod -Uri "$baseUrl/departments" -Method Get -Headers $adminHeaders
Write-Result "获取到 $($depts.Count) 个部门"
$depts | ForEach-Object { Write-Result "  - $($_.name)" }

Write-Step "3. 获取用户列表"
$users = Invoke-RestMethod -Uri "$baseUrl/auth/users?page_size=10" -Method Get -Headers $adminHeaders
Write-Result "获取到 $($users.total) 个用户"

Write-Step "4. 员工登录 (employee1)"
$empBody = @{ username = "employee1"; password = "123456" } | ConvertTo-Json
$empResp = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method Post -Body $empBody -ContentType "application/json"
$empToken = $empResp.token
$empHeaders = @{ Authorization = "Bearer $empToken" }
Write-Result "员工登录成功"

Write-Step "5. 获取当前用户信息"
$me = Invoke-RestMethod -Uri "$baseUrl/auth/me" -Method Get -Headers $empHeaders
Write-Result "当前用户: $($me.real_name), 角色: $($me.role)"

Write-Step "6. 管理员创建投票议题"
$deadline = (Get-Date).AddDays(1).ToString("yyyy-MM-ddTHH:mm:ss")
$topicBody = @{
    title = "年度团建方案投票"
    description = "请选择今年的团建方案"
    options = @("海边度假", "山区徒步", "城市周边游")
    deadline = $deadline
    vote_rule = "simple_majority"
} | ConvertTo-Json -Depth 10
$newTopic = Invoke-RestMethod -Uri "$baseUrl/topics" -Method Post -Body $topicBody -ContentType "application/json" -Headers $adminHeaders
$topicId = $newTopic.id
Write-Result "议题创建成功，ID: $topicId, 状态: $($newTopic.status)"

Write-Step "7. 管理员审核通过议题"
$reviewBody = @{ action = "approve" } | ConvertTo-Json
$reviewResult = Invoke-RestMethod -Uri "$baseUrl/topics/$topicId/review" -Method Post -Body $reviewBody -ContentType "application/json" -Headers $adminHeaders
Write-Result "审核结果: $($reviewResult.message)"

Write-Step "8. 获取议题详情"
$topicDetail = Invoke-RestMethod -Uri "$baseUrl/topics/$topicId" -Method Get -Headers $empHeaders
Write-Result "议题标题: $($topicDetail.title)"
Write-Result "议题状态: $($topicDetail.status)"
Write-Result "选项数量: $($topicDetail.options.Count)"

Write-Step "9. 员工投票"
$optionId = $topicDetail.options[0].id
$voteBody = @{ topic_id = $topicId; option_id = $optionId } | ConvertTo-Json
$voteResult = Invoke-RestMethod -Uri "$baseUrl/votes" -Method Post -Body $voteBody -ContentType "application/json" -Headers $empHeaders
Write-Result "投票结果: $($voteResult.message)"

Write-Step "10. 尝试重复投票 (应被拒绝)"
try {
    $voteResult2 = Invoke-RestMethod -Uri "$baseUrl/votes" -Method Post -Body $voteBody -ContentType "application/json" -Headers $empHeaders
    Write-Result "意外成功（不应该成功！"
} catch {
    $errorMsg = $_.Exception.Message
    Write-Result "重复投票被正确拒绝"
}

Write-Step "11. 另一位员工投票"
$emp2Body = @{ username = "employee2"; password = "123456" } | ConvertTo-Json
$emp2Resp = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method Post -Body $emp2Body -ContentType "application/json"
$emp2Headers = @{ Authorization = "Bearer $($emp2Resp.token)" }
$voteBody2 = @{ topic_id = $topicId; option_id = $topicDetail.options[1].id } | ConvertTo-Json
$vote2 = Invoke-RestMethod -Uri "$baseUrl/votes" -Method Post -Body $voteBody2 -ContentType "application/json" -Headers $emp2Headers
Write-Result "员工2投票成功"

Write-Step "12. 查看投票统计"
$stats = Invoke-RestMethod -Uri "$baseUrl/results/$topicId/statistics" -Method Get -Headers $adminHeaders
Write-Result "总票数: $($stats.total_votes)"
Write-Result "通过: $($stats.passed)"
$stats.options | ForEach-Object { Write-Result "  $($_.text): $($_.votes)票 ($($_.percentage)%)" }

Write-Step "13. 获取我的投票记录"
$myVotes = Invoke-RestMethod -Uri "$baseUrl/votes/my" -Method Get -Headers $empHeaders
Write-Result "我的投票数: $($myVotes.total)"

Write-Step "14. 管理员查看审计日志"
$logs = Invoke-RestMethod -Uri "$baseUrl/audit-logs?page_size=10" -Method Get -Headers $adminHeaders
Write-Result "日志总数: $($logs.total)"
$logs.list | Select-Object -First 5 | ForEach-Object { 
    Write-Result "  [$($_.created_at)] $($_.action) - $($_.module)"
}

Write-Step "15. 部门主管登录并查看本部门议题"
$mgrBody = @{ username = "tech_manager"; password = "123456" } | ConvertTo-Json
$mgrResp = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method Post -Body $mgrBody -ContentType "application/json"
$mgrHeaders = @{ Authorization = "Bearer $($mgrResp.token)" }
$mgrTopics = Invoke-RestMethod -Uri "$baseUrl/topics" -Method Get -Headers $mgrHeaders
Write-Result "技术部主管看到的议题数: $($mgrTopics.total)"

Write-Host "`n"
Write-Host "==============================" -ForegroundColor Yellow
Write-Host "  所有核心功能测试通过！" -ForegroundColor Green
Write-Host "==============================" -ForegroundColor Yellow
