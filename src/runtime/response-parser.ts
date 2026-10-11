const RESULT_BLOCK = /<achievement-update>\s*([\s\S]*?)\s*<\/achievement-update>/gi;

export function parseChildApiResponseText(source: string): Record<string, unknown> {
  const matches = [...source.matchAll(RESULT_BLOCK)];
  if (matches.length !== 1) {
    throw new Error(matches.length === 0
      ? '模型返回中缺少 <achievement-update> 结果块。'
      : '模型返回了多个 <achievement-update> 结果块。');
  }
  const json = matches[0]?.[1]?.trim() ?? '';
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('结果块必须包含一个 JSON 对象。');
    }
    const modelResponse = parsed as Record<string, unknown>;
    if (['requestId', 'chatId', 'baseRevision'].some(field => Object.hasOwn(modelResponse, field))) {
      throw new Error('请求标识由程序填写，请从已保存的提示词中移除旧的身份字段要求。');
    }
    return modelResponse;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('模型返回的 <achievement-update> 不是有效 JSON。');
    throw error;
  }
}
