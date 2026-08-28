# Security Audit Report — 高速公路鋪面檢測分析平台

**Audit Target**: `data-analysis`  
**Date**: 2026-08-28  
**Audit Methodology**: Cloudflare Security Audit Framework  
**Verdict**: 4 Confirmed Findings (1 HIGH, 3 MEDIUM), 2 Hardening Notes  

---

## 1. Executive Summary

本專案「高速公路鋪面檢測分析平台」主要由 React 19 / Vite 前端 SPA 與 Google Apps Script (GAS) / Google Sheets 後端資料庫組成。整體前端資料處理與圖表渲染具備良好的型別安全與防護（無 DOM XSS 或危險 HTML 注入點），但系統架構在**後端 Google Sheets 公式注入防護**、**認證邊界設計（將靜態 Secret 嵌入前端 Bundle）**、**動態工作表建立資源耗盡 (DoS)** 以及 **GAS 認證 Fail-Open 設計** 等方面存在可被利用的資安風險。最關鍵的風險為未跳脫 CSV 公式字元直接寫入 Google Sheets，使惡意上傳者可在管理員開啟試算表時觸發遠端資料外洩。

---

## 2. Baseline & Security Architecture Comparison

| 面向 | 本專案實作 | 主流標準 / 安全基準 | 差異與風險 |
|------|-----------|-------------------|-----------|
| **試算表寫入安全** | `sheet.setValues()` 直寫未跳脫字串 | 寫入前檢查並補 `'` (單引號) 轉純文字 | 未防範 CSV / Formula Injection |
| **API 認證機制** | 前端 Vite Bundle 內嵌 `API_SECRET` 並於 URL 帶參數 | OAuth 2.0 / 專屬後端 Proxy 代理 | 任何存取網站者均可取得金鑰直接呼叫後端 |
| **工作表管理** | 依未經白名單驗證的字串動態 `insertSheet` | 預設限制或白名單路線驗證 | 惡意構造大量工作表名稱可造成 DoS / 額度耗盡 |
| **預設安全機制** | `if (!API_SECRET) return true;` (Fail-Open) | `if (!API_SECRET) return false;` (Fail-Closed) | 未設定環境變數時後端完全開放 |

---

## 3. Findings Summary Table

| 編號 | 嚴重等級 | 漏洞標題 | 簡短說明 |
|------|---------|---------|---------|
| **VULN-01** | **HIGH** | [Google Sheets Formula Injection](#vuln-01-google-sheets-formula-injection-in-gas-backend) | 後端未過濾 CSV 公式字元直接寫入試算表，開啟時可能外洩資料 |
| **VULN-02** | **MEDIUM** | [Uncontrolled Sheet Creation Resource Exhaustion (DoS)](#vuln-02-uncontrolled-sheet-creation-resource-exhaustion-in-gas-backend) | 依未經驗證的輸入動態建立 Sheet，可能塞爆 Google 試算表限制 |
| **VULN-03** | **MEDIUM** | [Default-Open Authentication Bypass when API_SECRET is Unset](#vuln-03-default-open-authentication-bypass-when-api_secret-is-unset) | `API_SECRET` 未設定時預設放行所有請求，造成全域未授權存取 |
| **VULN-04** | **MEDIUM** | [Client-Side Secret Embedding & Broken Auth Architecture](#vuln-04-client-side-secret-embedding--broken-auth-architecture) | `VITE_GAS_API_KEY` 內嵌於前端靜態 Bundle，無法達到存取控制目的 |

---

## 4. Detailed Vulnerabilities & Remediation

### VULN-01: Google Sheets Formula Injection in GAS Backend
- **位置**: [gas/Code.gs:271](file:///c:/Users/linyu/.gemini/data-analysis/data-analysis/gas/Code.gs#L271) (`appendRows`)
- **攻擊情境**: 攻擊者透過 HTTP POST 上傳含有 `=IMPORTXML(...)` 或 `=HYPERLINK(...)` 欄位的鋪面檢測 CSV。後端透過 `setValues()` 寫入 Google Sheets。當管理員開啟試算表檢視時，Google Sheets 自動執行公式並將試算表內容外傳至外部伺服器。
- **影響**: 高（可能導致試算表機密歷史檢測資料全面外洩或進行釣魚導向）。
- **修復方案**: 在呼叫 `setValues()` 寫入單元格前，對所有文字開頭為 `=`, `+`, `-`, `@`, `\t`, `\r` 的字串前方加上 `'` (單引號) 進行純文字轉義。

---

### VULN-02: Uncontrolled Sheet Creation Resource Exhaustion in GAS Backend
- **位置**: [gas/Code.gs:88, 254](file:///c:/Users/linyu/.gemini/data-analysis/data-analysis/gas/Code.gs#L88) (`doPost` / `getOrCreateSheet`)
- **攻擊情境**: 攻擊者上傳包含數百筆偽造 `route` 或 `lane` 名稱的 CSV，觸發 `getOrCreateSheet` 連續呼叫 `SpreadsheetApp.insertSheet()` 建立大量新工作表。
- **影響**: 中（達到 Google 試算表上限或 6 分鐘執行逾時，造成平台同步失敗與服務癱瘓）。
- **修復方案**: 在後端建立 `ALLOWED_ROUTES` 白名單驗證，或限制一次請求中最多僅能建立的工作表數量。

---

### VULN-03: Default-Open Authentication Bypass when API_SECRET is Unset
- **位置**: [gas/Code.gs:17](file:///c:/Users/linyu/.gemini/data-analysis/data-analysis/gas/Code.gs#L17) (`isAuthorized`)
- **攻擊情境**: 若開發者在新環境部署 Google Apps Script 但未立即設定 `ScriptProperties.API_SECRET`，`isAuthorized` 會返回 `true`，使所有未帶 Key 的 GET / POST 請求皆能自由讀寫後端。
- **影響**: 中/高（在初始部署或設定遺失時導致全面未授權讀寫）。
- **修復方案**: 改為 Fail-Closed，若 `!API_SECRET` 則一律返回 `false` 並記錄錯誤。

---

### VULN-04: Client-Side Secret Embedding & Broken Auth Architecture
- **位置**: [src/lib/gasService.ts:8](file:///c:/Users/linyu/.gemini/data-analysis/data-analysis/src/lib/gasService.ts#L8) / [vite.config.ts:23](file:///c:/Users/linyu/.gemini/data-analysis/data-analysis/vite.config.ts#L23)
- **攻擊情境**: 靜態部署於 GitHub Pages 的前端 SPA 將 `VITE_GAS_API_KEY` 打包入 JS 檔案並於 URL 帶參數發送，訪客只需打開瀏覽器開發者工具即可取得金鑰並直接繞過前端介面存取 GAS API。
- **影響**: 中（使後端 Secret 機制失去實質防護效果）。
- **修復方案**: 靜態前端若需鑑權，應改採 Google Sign-In (OAuth 2.0 / User Token) 或由具備驗證機制的專屬後端 API 代理請求。

---

## 5. Hardening Notes (Defense-in-Depth)

1. **前端 Excel 匯出公式轉義 (`src/lib/exportUtils.ts`)**:
   `generateExportExcel` 在產出 `.xlsx` 檔案時，應對手動輸入欄位 (`unit`, `personnel`, `weather`, `description`) 進行公式字元轉義，避免使用者在匯出檔案中包含公式攻擊 Excel 客戶端。
2. **移除未使用的 `@google/genai` 與 build 設定**:
   `vite.config.ts` 定義了 `process.env.GEMINI_API_KEY`，且 `package.json` 包含 `@google/genai`，但專案內目前無相關 AI 呼叫邏輯。若無需使用應移除，避免無意間將 Secrets 打包進入靜態發布物。

---

## 6. Positive Security Patterns

1. **無危險 DOM 注入**: 全站使用 React 元件化渲染，未發現 `dangerouslySetInnerHTML` 或未受控之 DOM 操作，前端 XSS 防禦良好。
2. **正規劃與強型別解析**: `excelParser.ts` 具備完整的 Regex 驗證與資料轉換邏輯，對異常格式能適當降級與例外捕捉。
3. **Payload 大小限制**: GAS 後端已設置 `MAX_RECORDS = 5000` 防範單次過大 Payload 耗盡記憶體。
