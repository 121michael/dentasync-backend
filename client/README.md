# Amethyst Dental — Patient Portal

Responsive React/Vite frontend for the Amethyst Dental Premium Care Portal.

## Development

1. Start the backend in the repository root: `npm start`
2. Run the patient portal:

   ```bash
   cd client
   npm install
   npm run dev
   ```

Vite proxies `/api` requests to `http://localhost:5000`. To point at another API deployment, set `VITE_API_URL` to its `/api` base URL.

## Checks

```bash
npm run lint
npm run build
```
