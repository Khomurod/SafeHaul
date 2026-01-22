$functions = @(
    # 1. Documents & Email & Public Signing
    "sealDocument", "notifySigner", "getPublicEnvelope", "submitPublicEnvelope",
    
    # 2. Auth & User Management
    "createPortalUser", "deletePortalUser", "updatePortalUser", "onMembershipWrite",
    
    # 3. Company Admin
    "getCompanyProfile", "resolveCompanySlug", "joinCompanyTeam", "deleteCompany", "getTeamPerformanceHistory",
    
    # 4. Applications & Driver Sync
    "onApplicationSubmitted", "onLeadSubmitted", "syncDriverOnLog", "syncDriverOnActivity",
    "moveApplication", "sendAutomatedEmail",
    
    # 5. Leads & Distribution
    "cleanupBadLeads", "handleLeadOutcome", "migrateDriversToLeads", "confirmDriverInterest",
    "runLeadDistribution", "planLeadDistribution", "distributeDailyLeads", "getLeadSupplyAnalytics",
    "recallAllPlatformLeads", "forceUnlockPool", "getBadLeadsAnalytics", "getCompanyDistributionStatus",
    
    # 6. System Integrity
    "syncSystemStructure", "runSecurityAudit", "getSignedUploadUrl",
    
    # 7. Email Testing
    "testEmailConnection",
    
    # 8. Data Migration
    "runMigration",
    
    # 9. Global Search
    "searchUnifiedData",
    
    # 10. Scheduled Jobs
    "debugAppCounts",
    
    # 11. Integrations
    "connectFacebookPage", "facebookWebhook", "saveIntegrationConfig", "sendTestSMS",
    "executeReactivationBatch", "assignPhoneNumber", "addManualPhoneNumber",
    "addPhoneLine", "removePhoneLine", "testLineConnection", "verifyLineConnection",
    
    # 12. Stats Aggregation
    "onActivityLogCreated", "onLegacyActivityCreated", "onLeadsActivityLogCreated",
    
    # 13. Cloud Tasks Worker
    "processCompanyDistribution",
    
    # 14. Stats Backfill
    "backfillCompanyStats", "backfillAllStats"
)

$logFile = "deployment_report.md"
"# Deployment Report - $(Get-Date)" | Out-File $logFile
"" | Out-File $logFile -Append
"Total functions: $($functions.Count)" | Out-File $logFile -Append
"" | Out-File $logFile -Append
"| Function | Status | Time |" | Out-File $logFile -Append
"|---|---|---|" | Out-File $logFile -Append

foreach ($func in $functions) {
    Write-Host "Deploying $func..."
    $startTime = Get-Date
    
    # Run firebase deploy
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

Write-Host "Deployment sequence complete. See $logFile for details."
