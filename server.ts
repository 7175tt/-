import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { createGeminiRouter } from './server/geminiRoutes';
import { createDrivePhotoRouter } from './server/drivePhotoRoutes';

// Load local .env (if present) for local developer fallback matching the host platform
try {
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envLines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of envLines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = match[2] || '';
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.substring(1, val.length - 1);
        } else if (val.startsWith("'") && val.endsWith("'")) {
          val = val.substring(1, val.length - 1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch (e) {
  console.log("No local .env file parsed, relying on environment keys.");
}

const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api/gemini', createGeminiRouter());
  app.use('/api/drive', createDrivePhotoRouter());

  // --- Vite Middleware Server Setup ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('/{*all}', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Host connection binding
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on port ${PORT}`);
  });
  server.on('error', (error) => {
    console.error('Server could not listen:', error.message);
    process.exitCode = 1;
    process.exit(1);
  });
}

startServer().catch((err) => {
  console.error("Failed to start fullstack server:", err);
  process.exitCode = 1;
});
