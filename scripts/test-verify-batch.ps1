<#
.SYNOPSIS
    Smoke-tests the production /api/verify endpoint against multiple clips in one run.

.PARAMETER Token
    Bearer session token used for the Authorization header. Required. Never hardcode this value.

.EXAMPLE
    .\test-verify-batch.ps1 -Token "your-session-token-here"
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$Token
)

$ApiUrl = 'https://skept.co/api/verify'

# Fill in real clip URLs before running — none are pre-populated
$testClips = @(
    @{ Label = 'cartoon-cat (non-human exclusion test)'; Url = '<CARTOON_CAT_URL>' },
    @{ Label = 'real-face-control';                       Url = '<PASTE_URL_HERE>' },
    @{ Label = 'no-speech-audio-only';                    Url = '<PASTE_URL_HERE>' },
    @{ Label = 'synthetic-ai-generated';                  Url = '<PASTE_URL_HERE>' }
)

$headers = @{
    'Authorization' = "Bearer $Token"
    'Content-Type'  = 'application/json'
}

foreach ($clip in $testClips) {
    Write-Output "=== $($clip.Label) ==="

    $body = @{ url = $clip.Url } | ConvertTo-Json

    try {
        $response = Invoke-RestMethod -Uri $ApiUrl -Method Post -Headers $headers -Body $body
        $response | ConvertTo-Json -Depth 20
    } catch {
        Write-Output "ERROR: $($_.Exception.Message)"
        if ($_.Exception.Response) {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $errorBody = $reader.ReadToEnd()
            Write-Output "Response body: $errorBody"
        }
    }

    Write-Output ""
    Start-Sleep -Seconds 2
}
