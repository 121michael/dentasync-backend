# DentaSync frontend

React/Vite UI for the Amethyst Dental portals (patient, staff, admin, dentist).

## Development

1. Start the API from `backend/`: `npm start`
2. Run this app:

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

Vite proxies `/api` requests to `http://localhost:5000`. To point at another API deployment, set `VITE_API_URL` to its `/api` base URL.
