# Critical Functions - Core application functionality
# These functions must be deployed first for the app to work
$functions = @(
    # Company & Profile (required for login/auth)
    "getCompanyProfile", "resolveCompanySlug", "deleteCompany", "getTeamPerformanceHistory",
    
    # Application Processing (core workflow)
    "moveApplication", "sendAutomatedEmail", "runMigration",
    
    # Stats Aggregation (real-time updates)
    "onActivityLogCreated", "onLegacyActivityCreated", "onLeadsActivityLogCreated",
    
    # Lead Distribution (daily operations)
    "planLeadDistribution", "runLeadDistribution", "distributeDailyLeads", "getLeadSupplyAnalytics",
    "getCompanyDistributionStatus", "processCompanyDistribution",
    
    # Lead Management
    "cleanupBadLeads", "handleLeadOutcome", "confirmDriverInterest", "migrateDriversToLeads",
    "recallAllPlatformLeads", "forceUnlockPool", "getBadLeadsAnalytics"
)

$logFile = "deployment_critical_report.md"
"# Critical Functions Deployment Report - $(Get-Date)" | Out-File $logFile
"" | Out-File $logFile -Append
"Total critical functions: $($functions.Count)" | Out-File $logFile -Append
"" | Out-File $logFile -Append
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
