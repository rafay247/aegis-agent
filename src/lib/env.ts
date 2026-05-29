export const env = {
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  tavilyApiKey: process.env.TAVILY_API_KEY,
  pineconeApiKey: process.env.PINECONE_API_KEY,
  pineconeIndex: process.env.PINECONE_INDEX,
  redisUrl: process.env.REDIS_URL,
  databaseUrl: process.env.DATABASE_URL
};

export function hasOpenAiConfig() {
  return Boolean(env.openAiApiKey);
}

export function hasTavilyConfig() {
  return Boolean(env.tavilyApiKey);
}

export function hasRedisConfig() {
  return Boolean(env.redisUrl);
}

export function hasDatabaseConfig() {
  return Boolean(env.databaseUrl);
}
