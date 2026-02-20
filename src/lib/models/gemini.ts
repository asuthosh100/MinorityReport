import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");

export async function queryGemini(prompt: string): Promise<string> {
  const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
  const result = await model.generateContent(prompt);
  return result.response.text();
}
