import type { ContentModule } from '../domain/index.ts';
import type { RuntimeChatMessage } from './ports.ts';

export interface RequestTicket {
  requestId: string;
  chatId: string;
  sourceFingerprint: string;
  moduleIds: ContentModule[];
}

function fnv1a64(source: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const character of source) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

export function messageContentVersion(message: Pick<RuntimeChatMessage, 'role' | 'text'>): string {
  return `fnv1a64:${fnv1a64(JSON.stringify([message.role, message.text]))}`;
}

function messageFingerprint(messages: RuntimeChatMessage[]): string {
  const source = messages.map(message => [message.id, message.role, message.text]);
  return fnv1a64(JSON.stringify(source));
}

export function createRequestTicket(
  chatId: string,
  messages: RuntimeChatMessage[],
  moduleIds: ContentModule[],
  requestMaterial?: unknown,
): RequestTicket {
  const sortedModules = [...moduleIds].sort();
  const sourceFingerprint = messageFingerprint(messages);
  const requestId = `goblin-${fnv1a64(JSON.stringify([chatId, sourceFingerprint, sortedModules, ...(requestMaterial === undefined ? [] : [requestMaterial])]))}`;
  return { requestId, chatId, sourceFingerprint, moduleIds: sortedModules };
}

export function isRequestTicketCurrent(
  ticket: RequestTicket,
  currentChatId: string,
  currentMessages: RuntimeChatMessage[],
): boolean {
  return ticket.chatId === currentChatId && ticket.sourceFingerprint === messageFingerprint(currentMessages);
}
