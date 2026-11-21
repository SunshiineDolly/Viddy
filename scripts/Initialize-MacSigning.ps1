[CmdletBinding()]
param([string]$PrivateRoot=(Join-Path $env:LOCALAPPDATA 'Viddy/signing/macos'))
$ErrorActionPreference='Stop'
$openssl='C:/Program Files/Git/usr/bin/openssl.exe'
$repo=Split-Path $PSScriptRoot -Parent
$p12=Join-Path $PrivateRoot 'viddy-macos.p12'
$passwordFile=Join-Path $PrivateRoot 'password.dpapi'
$cert=Join-Path $PrivateRoot 'certificate.pem'
$key=Join-Path $PrivateRoot 'identity.pem'
$oldPassword=$env:VIDDY_CERT_PASSWORD
$headers=@{}; $credential=@{}
try {
 if(!(Test-Path -LiteralPath $p12)){
  if((Test-Path -LiteralPath $key) -or (Test-Path -LiteralPath $passwordFile)){throw 'Partial signing setup exists; nothing was replaced.'}
  $null=New-Item -ItemType Directory -Path $PrivateRoot -Force
  $bytes=[byte[]]::new(48);[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $env:VIDDY_CERT_PASSWORD=[Convert]::ToBase64String($bytes)
  $secure=ConvertTo-SecureString $env:VIDDY_CERT_PASSWORD -AsPlainText -Force
  $secure|ConvertFrom-SecureString|Set-Content -LiteralPath $passwordFile
  $config=Join-Path $PrivateRoot 'certificate.cnf'
  @'
[req]
distinguished_name=subject
x509_extensions=extensions
prompt=no
[subject]
CN=Viddy Mac Release Identity
O=Viddy
[extensions]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=critical,codeSigning
subjectKeyIdentifier=hash
'@ | Set-Content -LiteralPath $config
  & $openssl req -new -x509 -newkey rsa:3072 -sha256 -days 3650 -keyout $key -out $cert -passout env:VIDDY_CERT_PASSWORD -config $config 2>$null
  if($LASTEXITCODE){throw 'Could not create the Mac signing identity.'}
  & $openssl pkcs12 -export -inkey $key -in $cert -name 'Viddy Mac Release Identity' -out $p12 -passin env:VIDDY_CERT_PASSWORD -passout env:VIDDY_CERT_PASSWORD
  if($LASTEXITCODE){throw 'Could not prepare the encrypted signing identity.'}
 } else {
  $secure=Get-Content -LiteralPath $passwordFile -Raw|ConvertTo-SecureString
  $env:VIDDY_CERT_PASSWORD=[Net.NetworkCredential]::new('',$secure).Password
 }
 $lines="protocol=https`nhost=github.com`nusername=SunshiineDolly`n`n"|& git.exe -c credential.interactive=never credential fill
 if($LASTEXITCODE){throw 'Existing GitHub sign-in unavailable.'}
 foreach($line in $lines){if($line -match '^([^=]+)=(.*)$'){$credential[$Matches[1]]=$Matches[2]}}
 if(!$credential.password){throw 'GitHub publishing credential unavailable.'}
 $headers=@{Authorization="Bearer $($credential.password)";Accept='application/vnd.github+json';'User-Agent'='Viddy-signing-setup'}
 $account=Invoke-RestMethod 'https://api.github.com/user' -Headers $headers
 if($account.id -ne 349487638){throw 'Unexpected GitHub account; signing secrets were not uploaded.'}
 $api='https://api.github.com/repos/SunshiineDolly/Viddy/actions/secrets'
 $public=Invoke-RestMethod "$api/public-key" -Headers $headers
 $values=@{VIDDY_MAC_CERTIFICATE=[Convert]::ToBase64String([IO.File]::ReadAllBytes($p12));VIDDY_MAC_CERTIFICATE_PASSWORD=$env:VIDDY_CERT_PASSWORD}
 foreach($name in $values.Keys){
  $inputJson=@{key=$public.key;value=$values[$name]}|ConvertTo-Json -Compress
  $sealed=$inputJson|& node.exe (Join-Path $repo 'artifacts/seal-github-secret.cjs')
  if($LASTEXITCODE -or !$sealed){throw 'Secret encryption failed.'}
  $body=@{encrypted_value=([string]$sealed).Trim();key_id=$public.key_id}|ConvertTo-Json -Compress
  $null=Invoke-RestMethod -Method Put -Uri "$api/$name" -Headers $headers -ContentType 'application/json' -Body $body
 }
 $publicFolder=Join-Path $repo 'src-tauri/macos'
 $null=New-Item -ItemType Directory -Path $publicFolder -Force
 Copy-Item -LiteralPath $cert -Destination (Join-Path $publicFolder 'signing-certificate.pem')
 Write-Output 'Created or reused the encrypted Mac identity and configured the two private GitHub Actions secrets. No credentials displayed.'
} finally {
 $headers.Clear();$credential.Clear();$lines=$null;$values=$null;$inputJson=$null;$body=$null
 $env:VIDDY_CERT_PASSWORD=$oldPassword
 if($secure){$secure.Dispose()}
}
