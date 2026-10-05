# DentaSync

One GitHub repository with two folders:

| Folder | What it is |
| --- | --- |
| [`backend/`](./backend) | API server (Node, Express, PostgreSQL) |
| [`frontend/`](./frontend) | Website/app screens (React / Vite) |

Use lowercase folder names (`backend`, `frontend`). Windows treats `Frontend` and `frontend` as the same folder, so mixed capitalization causes Git problems.

## Run locally

**Terminal 1 — backend**

```bash
cd backend
npm install
npm run migrate
npm start
```

The API listens on `http://localhost:5000`. Put your `.env` file inside `backend/`.

**Terminal 2 — frontend**

```bash
cd frontend
npm install
npm run dev
```

The UI is at `http://localhost:5173`. Vite proxies `/api` to the backend.

On Windows you can also double-click `start.bat` in this folder (or in `backend/`) to start the API.

## Windows folder

Open **`C:\DentaSync-git`** in VS Code, on branch `cursor/split-frontend-backend-5dfe` (or later `cursor/staff-checkin-cleanup-5dfe` after merge). You should see both `backend` and `frontend` in Explorer.
