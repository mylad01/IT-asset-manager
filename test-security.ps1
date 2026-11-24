$PORT = 3099

Write-Host "=== TEST 1: Helmet security headers ==="
try { $r = Invoke-WebRequest -Uri "http://localhost:$PORT/uploads/" -Method GET -ErrorAction Stop } catch { $r = $_.Exception.Response }
$h = $r.Headers
Write-Host "X-Content-Type-Options: $($h['X-Content-Type-Options'])"
Write-Host "X-Frame-Options: $($h['X-Frame-Options'])"
Write-Host "Strict-Transport-Security: $($h['Strict-Transport-Security'])"

Write-Host "`n=== TEST 2: Zod rejects malformed login (missing email) ==="
try { Invoke-WebRequest -Uri "http://localhost:$PORT/api/auth/login" -Method POST -Body '{"password":"test1234"}' -ContentType "application/json" -ErrorAction Stop } catch {
  $errStream = $_.Exception.Response.GetResponseStream()
  $reader = New-Object System.IO.StreamReader($errStream)
  Write-Host "Status: $($_.Exception.Response.StatusCode.value__)"
  Write-Host "Body: $($reader.ReadToEnd())"
}

Write-Host "`n=== TEST 3: Valid format login returns 401 ==="
try { Invoke-WebRequest -Uri "http://localhost:$PORT/api/auth/login" -Method POST -Body '{"email":"test@test.com","password":"wrongpass"}' -ContentType "application/json" -ErrorAction Stop } catch {
  $errStream = $_.Exception.Response.GetResponseStream()
  $reader = New-Object System.IO.StreamReader($errStream)
  Write-Host "Status: $($_.Exception.Response.StatusCode.value__)"
  Write-Host "Body: $($reader.ReadToEnd())"
}

Write-Host "`n=== TEST 4: Departments require auth ==="
try { Invoke-WebRequest -Uri "http://localhost:$PORT/api/departments" -Method GET -ErrorAction Stop } catch {
  $errStream = $_.Exception.Response.GetResponseStream()
  $reader = New-Object System.IO.StreamReader($errStream)
  Write-Host "Status: $($_.Exception.Response.StatusCode.value__)"
  Write-Host "Body: $($reader.ReadToEnd())"
}

Write-Host "`n=== TEST 5: Dashboard requires auth ==="
try { Invoke-WebRequest -Uri "http://localhost:$PORT/api/dashboard/stats" -Method GET -ErrorAction Stop } catch {
  $errStream = $_.Exception.Response.GetResponseStream()
  $reader = New-Object System.IO.StreamReader($errStream)
  Write-Host "Status: $($_.Exception.Response.StatusCode.value__)"
  Write-Host "Body: $($reader.ReadToEnd())"
}

Write-Host "`n=== TEST 6: User create rejects bad role enum ==="
try { Invoke-WebRequest -Uri "http://localhost:$PORT/api/users" -Method POST -Body '{"name":"Test","email":"a@b.com","role":"SuperAdmin","password":"longpassword"}' -ContentType "application/json" -ErrorAction Stop } catch {
  $errStream = $_.Exception.Response.GetResponseStream()
  $reader = New-Object System.IO.StreamReader($errStream)
  Write-Host "Status: $($_.Exception.Response.StatusCode.value__)"
  Write-Host "Body: $($reader.ReadToEnd())"
}

Write-Host "`n=== TEST 7: Change password rejects short password ==="
try { Invoke-WebRequest -Uri "http://localhost:$PORT/api/auth/change-password" -Method PUT -Body '{"newPassword":"short"}' -ContentType "application/json" -ErrorAction Stop } catch {
  $errStream = $_.Exception.Response.GetResponseStream()
  $reader = New-Object System.IO.StreamReader($errStream)
  Write-Host "Status: $($_.Exception.Response.StatusCode.value__)"
  Write-Host "Body: $($reader.ReadToEnd())"
}

Write-Host "`n=== TEST 8: Oversized body rejected ==="
$big = '{"payload":"' + ("x" * 300000) + '"}'
try { Invoke-WebRequest -Uri "http://localhost:$PORT/api/auth/login" -Method POST -Body $big -ContentType "application/json" -ErrorAction Stop } catch {
  $errStream = $_.Exception.Response.GetResponseStream()
  $reader = New-Object System.IO.StreamReader($errStream)
  Write-Host "Status: $($_.Exception.Response.StatusCode.value__)"
  Write-Host "Body: $($reader.ReadToEnd())"
}

Write-Host "`n=== ALL TESTS COMPLETE ==="
