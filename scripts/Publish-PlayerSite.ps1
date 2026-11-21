[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$headers=@{};$credential=@{}
try {
 $lines="protocol=https`nhost=github.com`nusername=SunshiineDolly`n`n"|& git.exe -c credential.interactive=never credential fill
 if($LASTEXITCODE){throw 'Existing GitHub sign-in unavailable.'}
 foreach($line in $lines){if($line -match '^([^=]+)=(.*)$'){$credential[$Matches[1]]=$Matches[2]}}
 if(!$credential.password){throw 'No publishing credential available.'}
 $headers=@{Authorization="Bearer $($credential.password)";Accept='application/vnd.github+json';'User-Agent'='Viddy-player-publisher'}
 $account=Invoke-RestMethod 'https://api.github.com/user' -Headers $headers
 if($account.id -ne 349487638){throw 'Unexpected GitHub account; nothing published.'}
 $api='https://api.github.com/repos/SunshiineDolly/Viddy/pages'
 $existing=$null
 try{$existing=Invoke-RestMethod $api -Headers $headers}catch{if([int]$_.Exception.Response.StatusCode -ne 404){throw}}
 if($existing){
  if($existing.source.branch -cne 'codex/macos-app' -or $existing.source.path -cne '/docs'){throw 'An existing Pages configuration was found; it was not changed.'}
 }else{
  $body=@{build_type='legacy';source=@{branch='codex/macos-app';path='/docs'}}|ConvertTo-Json
  $existing=Invoke-RestMethod -Method Post -Uri $api -Headers $headers -ContentType 'application/json' -Body $body
 }
 Write-Output "Player site configured at $($existing.html_url) with the existing public repository."
}finally{$headers.Clear();$credential.Clear();$lines=$null}
