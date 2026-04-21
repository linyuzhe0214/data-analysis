# 高速公路鋪面檢測分析平台

> 上傳 CSV 資料，即時視覺化分析各路段 IRI / SN 歷年趨勢與色塊分布。

## Tech Stack

- **React 19** + **TypeScript**
- **Vite 6** (bundler)
- **Tailwind CSS v4** (via `@tailwindcss/vite`)
- **Recharts** (圖表)
- **PapaParse** (CSV 解析)
- **Lucide React** (icon)

---

## 本機開發

### Prerequisites

- Node.js ≥ 20
- npm ≥ 10

### 安裝與啟動

```bash
# 安裝套件
npm install

# 複製環境變數範本
cp .env.example .env.local
# 在 .env.local 填入你的 GEMINI_API_KEY

# 啟動 dev server（http://localhost:3000）
npm run dev
```

### 其他指令

| 指令 | 說明 |
|------|------|
| `npm run build` | TypeScript 型別檢查 + 建立 production bundle |
| `npm run preview` | 預覽 production build |
| `npm run lint` | 只做 TypeScript 型別檢查 |

---

## 部署（GitHub Pages）

### 1. 設定 GitHub Secrets

前往倉庫 → **Settings → Secrets and variables → Actions → New repository secret**，加入：

| Secret 名稱 | 值 |
|------------|-----|
| `GEMINI_API_KEY` | 你的 Gemini API Key |

### 2. 啟用 GitHub Pages

前往倉庫 → **Settings → Pages**：

- **Source** 選擇 `GitHub Actions`

### 3. 確認 workflow 設定

確認 `.github/workflows/deploy.yml` 中的 `VITE_BASE_PATH` 和你的倉庫名稱一致：

```yaml
VITE_BASE_PATH: /你的倉庫名稱/
```

### 4. 推送觸發部署

```bash
git add .
git commit -m "feat: initial deploy"
git push origin main
```

推送後 GitHub Actions 會自動 build 並部署，完成後網址為：

```
https://<你的GitHub帳號>.github.io/<倉庫名稱>/
```

---

## CSV 格式

上傳的 CSV 需要包含以下欄位：

| 欄位 | 型別 | 說明 |
|------|------|------|
| `year` | number | 年份（例如 2023） |
| `route` | string | 路線名稱（例如 國道1號） |
| `direction` | string | 方向（例如 北上、南下、東向、西向） |
| `lane` | string | 車道（選填，預設「外側車道」） |
| `mileage` | number | 里程（km） |
| `iri` | number | 不規則行駛指數 |
| `sn` | number | 滑動抗力數 |

---

## 專案結構

```
├── .github/workflows/deploy.yml   # GitHub Actions CI/CD
├── src/
│   ├── App.tsx                    # 主要應用邏輯與 UI
│   ├── components/                # 圖表元件
│   ├── data/                      # Mock 資料
│   ├── lib/                       # 工具函式
│   └── types.ts                   # TypeScript 型別定義
├── .env.example                   # 環境變數範本
├── vite.config.ts                 # Vite 設定
└── package.json
```
