import { GoogleGenerativeAI } from "@google/generative-ai";

function getClient() {
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");
}

export async function queryGemini(prompt: string): Promise<string> {
  const model = getClient().getGenerativeModel({ model: "gemini-2.0-flash" });
  const result = await model.generateContent(prompt);
  return result.response.text();
}
