
import { GoogleGenAI } from "@google/genai"; // Keep import even if not directly used, for consistency/future

export default async function handler(req, res) {
  const { term } = req.query;

  // --- API KEY VALIDATION ---
  const API_KEY = process.env.API_KEY;
  if (!API_KEY) {
    console.error("[API/SEARCH] API_KEY environment variable is not set or is empty.");
    return res.status(401).json({ error: 'API_KEY environment variable is missing from serverless function. Please ensure it is correctly configured in your deployment environment (e.g., Vercel environment variables or AI Studio settings).' });
  }
  // --- END API KEY VALIDATION ---

  if (!term) {
    return res.status(400).json({ error: 'Missing search term' });
  }

  try {
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&limit=1&entity=song`;
    const response = await fetch(itunesUrl);
    const data = await response.json();

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch data from iTunes' });
  }
}