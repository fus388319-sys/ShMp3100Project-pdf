import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.post('/api/analyze-document', async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: 'Document analysis service is not configured.',
        });
      }

      const body = req.body as {
        images?: Array<{ mimeType?: string; dataBase64?: string }>;
        scanMode?: string;
      };

      const images = Array.isArray(body?.images) ? body.images.slice(0, 6) : [];
      if (images.length === 0) {
        return res.status(400).json({ error: 'At least one scanned page image is required.' });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const imageParts = images
        .filter((img) => typeof img.dataBase64 === 'string' && img.dataBase64.length > 0)
        .map((img) => ({
          inlineData: {
            mimeType: img.mimeType || 'image/jpeg',
            data: img.dataBase64 as string,
          },
        }));

      if (imageParts.length === 0) {
        return res.status(400).json({ error: 'Valid image data is required.' });
      }

      const scanModeLabel = typeof body?.scanMode === 'string' ? body.scanMode : 'Doc';

      const promptText =
        `You are inspecting ${imageParts.length} scanned page image(s) captured in "${scanModeLabel}" mode. ` +
        `Identify the book name, document title, or receipt/ID header visible in the pages. ` +
        `Generate a clean concise filename (letters, numbers, underscores only, no extension) and create an accurate page-by-page index / table of contents for every provided page (1 to ${imageParts.length}).`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [...imageParts, { text: promptText }],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              documentTitle: {
                type: Type.STRING,
                description: 'Detected book title, document heading, or subject name.',
              },
              suggestedFilename: {
                type: Type.STRING,
                description: 'Clean filename without .pdf extension, using underscores.',
              },
              authorOrIssuer: {
                type: Type.STRING,
                description: 'Book author, publisher, store, or issuing organization if visible.',
              },
              indexEntries: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    pageNumber: { type: Type.INTEGER },
                    heading: { type: Type.STRING },
                    summary: { type: Type.STRING },
                  },
                },
              },
            },
          },
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);
      return res.json(parsed);
    } catch (err) {
      console.error('Analyze document error:', err);
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to analyze scanned pages.',
      });
    }
  });

  app.post('/api/ai-detect-crop', async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: 'AI document capture is unavailable (API key not configured in Secrets).',
        });
      }

      const body = req.body as {
        imageBase64?: string;
        mimeType?: string;
        scanMode?: string;
      };

      const imageBase64 = typeof body?.imageBase64 === 'string' ? body.imageBase64.trim() : '';
      if (!imageBase64) {
        return res.status(400).json({ error: 'Captured page image data is required.' });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const scanModeLabel = typeof body?.scanMode === 'string' ? body.scanMode : 'Doc';

      const promptText =
        `Inspect this captured camera frame in "${scanModeLabel}" scan mode. ` +
        `Locate the outer four edges of the physical document/book/page/receipt/ID card inside the frame. ` +
        `Return normalized inset crop fractions (0.0 to 0.42) from each edge of the image (left, top, right, bottom) to tightly crop out background desk/table and keep only the clean page. ` +
        `Also assess focusQuality ("sharp", "moderate", or "blurry"), whether a document is clearly present (documentDetected), a short pageHeading, documentTitle, and recommendedFilter ("original", "crisp", "grayscale", or "bw").`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: body?.mimeType || 'image/jpeg',
                data: imageBase64,
              },
            },
            { text: promptText },
          ],
        },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              documentDetected: { type: Type.BOOLEAN },
              focusQuality: {
                type: Type.STRING,
                description: 'One of: sharp, moderate, blurry',
              },
              left: {
                type: Type.NUMBER,
                description: 'Fraction of image width to trim from the left edge (0 to 0.42)',
              },
              top: {
                type: Type.NUMBER,
                description: 'Fraction of image height to trim from the top edge (0 to 0.42)',
              },
              right: {
                type: Type.NUMBER,
                description: 'Fraction of image width to trim from the right edge (0 to 0.42)',
              },
              bottom: {
                type: Type.NUMBER,
                description: 'Fraction of image height to trim from the bottom edge (0 to 0.42)',
              },
              documentTitle: { type: Type.STRING },
              pageHeading: { type: Type.STRING },
              recommendedFilter: {
                type: Type.STRING,
                description: 'One of: original, crisp, grayscale, bw',
              },
            },
          },
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);
      return res.json(parsed);
    } catch (err) {
      console.error('AI detect-crop error:', err);
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'AI page detection failed.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ShMp3100 PDFMR Server running on http://localhost:${PORT}`);
  });
}

startServer();
