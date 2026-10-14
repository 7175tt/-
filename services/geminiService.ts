import { BusinessCard } from '../types';

/**
 * Extracts text from a base64 encoded image by calling the backend server proxy.
 * @param base64Image The base64 encoded image string.
 * @returns The raw text extracted from the image.
 */
export const extractTextFromImage = async (base64Image: string): Promise<string> => {
  const response = await fetch('/api/gemini/extract', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ base64Image }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP 錯誤: ${response.status}`);
  }

  const data = await response.json();
  return data.text;
};

/**
 * Structures raw text into a BusinessCard JSON object by calling the backend server proxy.
 * @param rawText The raw text extracted from a business card.
 * @returns A structured BusinessCard object or null if parsing fails.
 */
export const structureText = async (rawText: string): Promise<Omit<BusinessCard, 'id' | 'timestamp' | 'imageBase64'> | null> => {
  try {
    const response = await fetch('/api/gemini/structure', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rawText }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP 錯誤: ${response.status}`);
    }

    const data = await response.json();
    return data.structuredData;
  } catch (e) {
    console.error("Failed to parse JSON response from Gemini server proxy:", e);
    return null;
  }
};
