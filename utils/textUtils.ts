// Helper for RTL detection (Hebrew + Arabic ranges)
// Hebrew: \u0590-\u05FF
// Arabic: \u0600-\u06FF
export const isRtl = (text: string) => /[\u0590-\u05FF\u0600-\u06FF]/.test(text);