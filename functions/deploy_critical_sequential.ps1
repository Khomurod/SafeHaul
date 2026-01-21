$functions = @(
    "getCompanyProfile", "deleteCompany", "getTeamPerformanceHistory", "moveApplication", "sendAutomatedEmail", "runMigration",
    "onActivityLogCreated", "onLegacyActivityCreated", "onLeadsActivityLogCreated",
    "planLeadDistribution", "runLeadDistribution", "distributeDailyLeads", "getLeadSupplyAnalytics",
    "cleanupBadLeads", "handleLeadOutcome", "confirmDriverInterest", "migrateDriversToLeads"
)

$logFile = "deployment_critical_report.md"
"# Critical Functions Deployment Report - $(Get-Date)" | Out-File $logFile
"| Function | Status | Time |" | Out-File $logFile -Append
"|---|---|---|" | Out-File $logFile -Append

foreach ($func in $functions) {
    Write-Host "Deploying $func..."
    $startTime = Get-Date
    
    try {
        $process = Start-Process -FilePath "cmd" -ArgumentList "/c firebase deploy --only functions:$func" -Wait -NoNewWindow -PassThru
        $exitCode = $process.ExitCode
    } catch {
        $exitCode = 1
    }

    $endTime = Get-Date
    $duration = ($endTime - $startTime).TotalSeconds

    if ($exitCode -eq 0) {
        Write-Host "SUCCESS: $func (took $($duration)s)" -ForegroundColor Green
        "| $func | ✅ Success | $($duration)s |" | Out-File $logFile -Append
    } else {
        Write-Host "FAILURE: $func (took $($duration)s)" -ForegroundColor Red
        "| $func | ❌ Failed | $($duration)s |" | Out-File $logFile -Append
    }

    Write-Host "Waiting 10 seconds..."
    Start-Sleep -Seconds 10
}

Write-Host "Critical deployment sequence complete. See $logFile for details."
