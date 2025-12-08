export default async function handler(req, res) {
  // 1. Get the search term from the frontend
  const { term } = req.query;

  if (!term) {
    return res.status(400).json({ error: 'Missing search term' });
  }

  try {
    // 2. Perform the search on the SERVER side (Immune to CORS/Mobile Blocks)
    // We enforce US store and English language to prevent geo-redirects
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&limit=1&entity=song&country=US&lang=en_us`;
    
    const response = await fetch(itunesUrl);
    
    if (!response.ok) {
        throw new Error(`iTunes API error: ${response.status}`);
    }

    const data = await response.json();

    // 3. Add Cache Headers (Performance)
    // Cache this search result for 1 hour (3600 seconds)
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    
    // 4. Return clean JSON to the frontend
    return res.status(200).json(data);

  } catch (error) {
    console.error('Proxy Error:', error);
    return res.status(500).json({ error: 'Failed to fetch data from iTunes' });
  }
}
