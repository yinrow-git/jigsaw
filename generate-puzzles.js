#!/usr/bin/env node
// Generate puzzle images using Google Imagen 3 and save to ./puzzles/
//
// Usage:
//   GEMINI_API_KEY=your_key node generate-puzzles.js "a misty mountain lake at sunrise" 4
//   GEMINI_API_KEY=your_key node generate-puzzles.js  ← uses a random built-in prompt

const { GoogleGenAI } = require("@google/genai");
const fs = require("fs");
const path = require("path");

const PUZZLES_DIR = path.join(__dirname, "puzzles");

// Built-in prompts used when no prompt is given on the command line
const DEFAULT_PROMPTS = [
  "a tranquil Japanese garden in spring with cherry blossoms reflected in a koi pond, soft watercolor style",
  "a cozy European bookshop on a rainy evening, warm light spilling through the window, painterly illustration",
  "a vibrant Chinese ink painting of cranes flying over misty mountains at dawn",
  "a sun-drenched Provençal lavender field with a stone farmhouse in the distance, impressionist style",
  "a magical forest clearing at twilight with fireflies and a small glowing cottage, storybook illustration",
  "a bustling night market in a traditional Asian city, lanterns and street food stalls, vivid gouache painting",
  "a serene Nordic fjord at golden hour with a wooden cabin and its reflection in still water, oil painting",
  "a whimsical aerial view of a medieval European village surrounded by autumn forests, detailed illustration",
];

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Set GEMINI_API_KEY before running:");
    console.error('  GEMINI_API_KEY=your_key node generate-puzzles.js "your prompt" [count]');
    process.exit(1);
  }

  const prompt = process.argv[2] || DEFAULT_PROMPTS[Math.floor(Math.random() * DEFAULT_PROMPTS.length)];
  const count = Math.min(4, parseInt(process.argv[3]) || 1); // Imagen 3 max is 4 per request

  console.log(`Prompt: "${prompt}"`);
  console.log(`Generating ${count} image(s)...\n`);

  const ai = new GoogleGenAI({ apiKey });
  fs.mkdirSync(PUZZLES_DIR, { recursive: true });

  const response = await ai.models.generateImages({
    model: "imagen-3.0-generate-002",
    prompt,
    config: {
      numberOfImages: count,
      outputMimeType: "image/jpeg",
      aspectRatio: "4:3",
    },
  });

  const images = response.generatedImages;
  if (!images || images.length === 0) {
    console.error("No images returned.");
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, "").slice(0, 14);

  for (let i = 0; i < images.length; i++) {
    const imageBytes = images[i].image.imageBytes;
    const buffer = Buffer.from(imageBytes, "base64");
    const suffix = images.length > 1 ? `_${i + 1}` : "";
    const filename = `generated_${timestamp}${suffix}.jpg`;
    const dest = path.join(PUZZLES_DIR, filename);
    fs.writeFileSync(dest, buffer);
    console.log(`Saved: puzzles/${filename} (${Math.round(buffer.length / 1024)} KB)`);
  }

  console.log("\nDone! Run ./upload-puzzles.sh to push to Railway.");
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
