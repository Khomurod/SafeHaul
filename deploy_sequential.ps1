# SafeHaul Unified Sequential Deployment Script
# Purpose: Deploy all active functions one-by-one with pauses to avoid CPU spikes.

$functions = @(
    # 1. Core Infrastructure & Auth
    "createPortalUser", "deletePortalUser", "updatePortalUser", "onMembershipWrite", 
    "joinCompanyTeam", "deleteCompany",
    
    # 2. Document Processing & Flows
    "sealDocument", "notifySigner", "getPublicEnvelope", "submitPublicEnvelope", 
    "onApplicationSubmitted", "onLeadSubmitted", "syncDriverOnLog", 
    "syncDriverOnActivity", "sendAutomatedEmail",
    
    # 3. Lead Distribution & Management
    "cleanupBadLeads", "handleLeadOutcome", "migrateDriversToLeads", 
    "confirmDriverInterest", "runLeadDistribution", "planLeadDistribution", 
    "distributeDailyLeads", "getLeadSupplyAnalytics", "recallAllPlatformLeads", 
    "forceUnlockPool", "getBadLeadsAnalytics", "getCompanyDistributionStatus", 
    "processCompanyDistribution",
    
    # 4. SMS & Messaging Integrations
    "saveIntegrationConfig", "verifySmsConfig", "sendTestSMS", "sendSMS", 
    "executeReactivationBatch", "initBulkSession", "processBulkBatch", 
    "retryFailedAttempts", "addPhoneLine", "removePhoneLine", 
    "testLineConnection", "verifyLineConnection", "connectFacebookPage", 
    "facebookWebhook", "facebookWebhookV1",
    
    # 5. Monitoring, Tools & Stats
    "syncSystemStructure", "runSecurityAudit", "getSignedUploadUrl", 
    "testEmailConnection", "runMigration", "debugAppCounts", 
    "onActivityLogCreated", "onLegacyActivityCreated", "onLeadsActivityLogCreated", 
    "backfillCompanyStats", "backfillAllStats"
)

$logFile = "deployment_report.md"
"# Deployment Report - $(Get-Date)" | Out-File $logFile
"" | Out-File $logFile -Append
"Total functions: $($functions.Count)" | Out-File $logFile -Append
"" | Out-File $logFile -Append
"| Function | Status | Duration |" | Out-File $logFile -Append
"|---|---|---|" | Out-File $logFile -Append

foreach ($func in $functions) {
    Write-Host "--- Deploying $func ---" -ForegroundColor Cyan
    $startTime = Get-Date
    
    try {
        $process = Start-Process -FilePath "cmd" -ArgumentList "/c firebase deploy --only functions:$func" -Wait -NoNewWindow -PassThru
        $exitCode = $process.ExitCode
    }
    catch {
        $exitCode = 1
    }

    $endTime = Get-Date
    $duration = [math]::Round(($endTime - $startTime).TotalSeconds, 2)

    if ($exitCode -eq 0) {
        Write-Host "SUCCESS: $func ($($duration)s)" -ForegroundColor Green
        "| $func | ✅ Success | $($duration)s |" | Out-File $logFile -Append
    }
    else {
        Write-Host "FAILURE: $func ($($duration)s)" -ForegroundColor Red
        "| $func | ❌ Failed | $($duration)s |" | Out-File $logFile -Append
    }

    Write-Host "Cooling down for 15 seconds..." -ForegroundColor Yellow
    Start-Sleep -Seconds 15
}

Write-Host "Deployment cycle complete. Details saved to $logFile." -ForegroundColor Green
