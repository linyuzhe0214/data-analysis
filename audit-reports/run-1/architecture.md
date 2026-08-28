# System Architecture & Threat Model

## 1. Application Overview & Tech Stack
- **Application**: 高速公路鋪面檢測分析平台 (Highway Pavement Detection & Analysis Platform)
- **Type**: Single Page Application (SPA) + Serverless Backend + CI/CD
- **Frontend Tech Stack**: React 19, TypeScript, Vite 6, Tailwind CSS v4, Recharts, SheetJS (xlsx), PapaParse, Lucide React
- **Backend Tech Stack**: Google Apps Script (GAS) Web App, Google Sheets (Spreadsheet Database)
- **Deployment Model**: GitHub Pages (Static hosting via GitHub Actions CI/CD) + GAS Executable Endpoint (`/exec`)
- **Users**: Highway pavement inspection engineers, maintenance personnel, system administrators

## 2. Trust Boundaries & Actors
- **Untrusted Actors / Public Internet**: Any visitor or external client accessing the GitHub Pages URL or GAS Web App endpoint.
- **Frontend SPA Boundary**: Runs in the client browser. No secret or authorization logic in the frontend can be considered secure against malicious users.
- **Backend Boundary (Google Apps Script)**: Acts as the data persistence layer for Google Sheets. Authenticates via query parameter `?key=...` mapped to `API_SECRET` in `ScriptProperties`.
- **Database Boundary (Google Sheets)**: Stores inspection records (`SN_Data` / `IRI_*` sheets). Formulas within cells are evaluated by Google Sheets engine.

## 3. Input Surfaces & Sinks
1. **Network Input (GAS Web App)**:
   - `GET /exec?type=all|sn|iri|iri_sheets&key=<key>&nocache=1` — Fetches raw rows from Google Sheets.
   - `POST /exec?type=sn|iri&key=<key>` — Receives raw CSV text to parse and insert into sheets.
2. **File Ingestion**:
   - `parseSNFile`, `parseIRIFile`, `parseWithMapping` in `src/lib/excelParser.ts` — Parses Excel (.xlsx/.xls) and CSV files uploaded by users.
3. **File Export**:
   - `generateExportExcel` in `src/lib/exportUtils.ts` — Generates `.xlsx` files from in-memory pavement records and manual metadata.
4. **Dangerous Sinks**:
   - `SpreadsheetApp.openById(SS_ID).insertSheet(...)` — Dynamic worksheet creation in `gas/Code.gs`.
   - `sheet.getRange(...).setValues(rows)` — Writes unescaped cell data to Google Sheets (Formula Injection sink).
   - Client JS Bundle (`dist/assets/*.js`) — Build-time secret injection (`VITE_GAS_API_KEY`, `GEMINI_API_KEY`).

## 4. Baseline Comparable
- **Comparable**: Web-based analytical dashboards and GIS inspection systems backed by Google Workspace/Sheets or serverless database backends.
- **Security Baseline**: Google Sheets backends must enforce strict cell sanitization (Formula escaping), robust role-based authentication rather than shared client-side secrets, bounded sheet creation limits, and fail-closed authentication.
