import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

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

const PORT = 3000;

// Lazy initialization of GenAI client
let ai: GoogleGenAI | undefined;
const getAi = (): GoogleGenAI => {
  if (!ai) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("伺服器端尚未設定 GEMINI_API_KEY 環境變數。請在 settings/secrets 設定。");
    }
    ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return ai;
};

async function startServer() {
  const app = express();

  // Set high limits so that oversized high-res business card scans doesn't fail
  app.use(express.json({ limit: "20mb" }));

  // --- API Endpoints ---

  // 1. OCR text extraction from card image
  app.post("/api/gemini/extract", async (req, res) => {
    try {
      const { base64Image } = req.body;
      if (!base64Image) {
        res.status(400).json({ error: "名片影像資料不完整。" });
        return;
      }

      const aiClient = getAi();
      let cleanBase64 = base64Image;
      let mimeType = "image/jpeg";

      const mimeMatch = base64Image.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.*)$/);
      if (mimeMatch) {
        mimeType = mimeMatch[1];
        cleanBase64 = mimeMatch[2];
      }

      const imagePart = {
        inlineData: {
          mimeType: mimeType,
          data: cleanBase64,
        },
      };

      const textPart = {
        text: "從這張名片圖片中提取所有可辨識的文字。請將所有辨識到的文字以純文字格式回傳，每段文字換行分隔。",
      };

      const response = await aiClient.models.generateContent({
        model: "gemini-3.5-flash",
        contents: { parts: [imagePart, textPart] },
      });

      res.json({ text: response.text || "" });
    } catch (error: any) {
      console.error("OCR Extraction Error:", error);
      res.status(500).json({ error: error.message || "名片讀取失敗，請確認影像是否正確。" });
    }
  });

  // 2. Structuring OCR raw text to unified business card data schema
  app.post("/api/gemini/structure", async (req, res) => {
    try {
      const { rawText } = req.body;
      if (!rawText) {
        res.status(400).json({ error: "OCR 文字不存在。" });
        return;
      }

      const aiClient = getAi();
      const prompt = `
        請分析以下從名片 OCR 得到的原始文字，並將其轉換為 JSON 格式。

        JSON 格式必須包含以下欄位：
        - name (string): 姓名
        - company (string): 公司名稱
        - title (string): 職稱
        - phone (string): 電話號碼 (只保留數字與主要符號, 如 '+', '-')
        - email (string): 電子郵件
        - address (string): 公司地址

        如果某個欄位在原始文字中找不到對應的資訊，請使用空字串 "" 作為該欄位的值。
        請只回傳 JSON 物件本身，不要包含任何額外的說明或 markdown 標籤。

        原始文字如下：
        ---
        ${rawText}
        ---
      `;

      const response = await aiClient.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              company: { type: Type.STRING },
              title: { type: Type.STRING },
              phone: { type: Type.STRING },
              email: { type: Type.STRING },
              address: { type: Type.STRING },
            }
          }
        },
      });

      const parsedData = JSON.parse(response.text?.trim() || "{}");

      res.json({
        structuredData: {
          name: parsedData.name || '',
          company: parsedData.company || '',
          title: parsedData.title || '',
          phone: parsedData.phone || '',
          email: parsedData.email || '',
          address: parsedData.address || '',
          notes: '',
          rawText: rawText,
      }
      });
    } catch (error: any) {
      console.error("Formatting Structure Error:", error);
      res.status(500).json({ error: error.message || "名片結構化解析失敗。" });
    }
  });

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
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Host connection binding
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server starting securely on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start fullstack server:", err);
});
