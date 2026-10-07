# Run manually from your normal PowerShell terminal after approving deployment.
# Only the saved-plan change's files are staged. No migration or force push.
$planFiles = @(
  'AGENTS.md',
  'codex/README.md',
  'codex/deploy-saved-plan.ps1',
  'package.json',
  'src/components/TodayPage.tsx',
  'src/hooks/useCodexSync.ts',
  'src/lib/executiveDirective.ts',
  'src/lib/taskCapacity.ts',
  'src/lib/today.ts',
  'supabase/functions/_shared/dayPlan.ts',
  'supabase/functions/codex-api/index.ts',
  'supabase/functions/executive-assistant-mcp/index.ts',
  'tests/day-plan.test.mjs',
  'tests/calendar-sync.test.mjs',
  'plan-preview.html',
  'src/editor-test/DayPlanPreview.tsx'
)

Push-Location -LiteralPath (Split-Path -Parent $PSScriptRoot) -ErrorAction Stop
try {
  $planBranch = git branch --show-current
  if ($LASTEXITCODE -ne 0 -or $planBranch -ne 'main') {
    throw 'Expected the executive-assistant checkout on main. No files staged.'
  }
  git fetch origin main
  if ($LASTEXITCODE -ne 0) { throw 'Fetch failed; nothing staged or committed.' }
  $planBehind = git rev-list --count HEAD..origin/main
  if ($LASTEXITCODE -ne 0 -or [int]$planBehind -gt 0) {
    throw 'Remote main has newer changes. Reconcile them before deployment; no automatic merge.'
  }
  git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) { throw 'There are already staged changes. Review them before running this helper.' }
  git add -- @planFiles
  if ($LASTEXITCODE -ne 0) { throw 'Staging failed; no commit or push attempted.' }
  git diff --cached --check
  if ($LASTEXITCODE -ne 0) { throw 'Whitespace check failed; no commit or push attempted.' }
  git commit -m 'feat: share saved daily plan and remember planning decisions'
  if ($LASTEXITCODE -ne 0) { throw 'Commit failed; no push attempted.' }
  git push origin main
  if ($LASTEXITCODE -ne 0) { throw 'Push failed; the local commit is retained.' }
  Write-Host 'Pushed. The connected Vercel frontend and GitHub Edge Function workflow will start deploying.'
  Write-Host 'This is not confirmation that either deployment succeeded; verify both before calling it live.'
} finally {
  Pop-Location
}
