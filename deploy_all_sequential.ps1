$functions = @(
    "sealDocument", "notifySigner", "getPublicEnvelope", "submitPublicEnvelope",
    "createPortalUser", "deletePortalUser", "updatePortalUser", "onMembershipWrite",
    "getCompanyProfile", "joinCompanyTeam", "deleteCompany", "getTeamPerformanceHistory",
    "onApplicationSubmitted", "onLeadSubmitted", "syncDriverOnLog", "syncDriverOnActivity",
    "moveApplication", "sendAutomatedEmail",
    "cleanupBadLeads", "handleLeadOutcome", "migrateDriversToLeads", "confirmDriverInterest",
    "runLeadDistribution", "planLeadDistribution", "distributeDailyLeads", "getLeadSupplyAnalytics",
    "syncSystemStructure", "runSecurityAudit", "getSignedUploadUrl",
    "testEmailConnection",
    "runMigration",
    "searchUnifiedData",
    "debugAppCounts",
    "connectFacebookPage", "facebookWebhook", "saveIntegrationConfig", "sendTestSMS",
    "executeReactivationBatch", "assignPhoneNumber", "addManualPhoneNumber",
    "addPhoneLine", "removePhoneLine", "testLineConnection",
    "onActivityLogCreated", "onLegacyActivityCreated", "onLeadsActivityLogCreated",
    "processCompanyDistribution",
    "backfillCompanyStats", "backfillAllStats"
)

$logFile = "deployment_report.md"
"# Deployment Report - $(Get-Date)" | Out-File $logFile
"| Function | Status | Time |" | Out-File $logFile -Append
"|---|---|---|" | Out-File $logFile -Append

foreach ($func in $functions) {
    Write-Host "Deploying $func..."
    $startTime = Get-Date
    
    # Run firebase deploy
    # Note: We use cmd /c to ensure firebase command is found and executed properly
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
