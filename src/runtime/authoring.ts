import { applyAuthorCommand, authorDiagnostics, upgradeAuthorDocument, type AuthorCommand, type AuthorDocument } from '../domain/authoring.ts';
import type { ContentPackBinding, ValidationIssue } from '../domain/types.ts';

export interface AuthorDraft extends AuthorDocument { revision: string; source?: ContentPackBinding }
export interface AuthorPreflight { revision: string; fingerprint: string; issues: ValidationIssue[] }
export interface AuthorStoragePort {
  list(): Promise<Array<{ packId: string; packName: string }>>;
  load(packId: string): Promise<AuthorDraft>;
  create(packId: string, packName: string): Promise<AuthorDraft>;
  importRelease(binding: ContentPackBinding): Promise<AuthorDraft>;
  save(draft: AuthorDraft): Promise<AuthorDraft>;
  refreshAssets(packId: string, revision: string): Promise<AuthorDraft>;
  preflight(packId: string, revision: string): Promise<AuthorPreflight>;
  publish(packId: string, preflight: AuthorPreflight): Promise<ContentPackBinding>;
}

export interface AuthorSession {
  dirty: boolean;
  snapshot(): AuthorDraft;
  issues(): ValidationIssue[];
  dispatch(command: AuthorCommand): void;
  undo(): void;
  redo(): void;
  save(storage: AuthorStoragePort): Promise<void>;
  replaceSaved(draft: AuthorDraft): void;
}
export class AuthorEditor implements AuthorSession {
  private draft: AuthorDraft;
  private history: AuthorDraft[] = [];
  private future: AuthorDraft[] = [];
  dirty = false;
  constructor(draft: AuthorDraft) {
    this.draft = { ...structuredClone(draft), ...upgradeAuthorDocument(draft) };
    this.dirty = JSON.stringify(this.draft) !== JSON.stringify(draft);
  }
  snapshot(): AuthorDraft { return structuredClone(this.draft); }
  issues(): ValidationIssue[] { return authorDiagnostics(this.draft); }
  dispatch(command: AuthorCommand): void {
    const next = applyAuthorCommand(this.draft, command);
    this.history.push(this.snapshot());
    this.future = [];
    this.draft = { ...this.draft, ...next };
    this.dirty = true;
  }
  undo(): void {
    const previous = this.history.pop();
    if (!previous) return;
    this.future.push(this.snapshot()); this.draft = { ...previous, revision: this.draft.revision }; this.dirty = true;
  }
  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.history.push(this.snapshot()); this.draft = { ...next, revision: this.draft.revision }; this.dirty = true;
  }
  async save(storage: AuthorStoragePort): Promise<void> {
    const submitted = this.snapshot();
    const saved = await storage.save(submitted);
    this.draft.revision = saved.revision;
    this.dirty = JSON.stringify({ ...this.draft, revision: '' }) !== JSON.stringify({ ...submitted, revision: '' });
  }
  replaceSaved(draft: AuthorDraft): void {
    this.history.push(this.snapshot()); this.future = []; this.draft = structuredClone(draft); this.dirty = false;
  }
}
