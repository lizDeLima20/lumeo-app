import { IndexedDbService, STORE_NAMES } from "../services/IndexedDbService";

export interface AudiobookProgress { audiobookId: string; positionSeconds: number; durationSeconds?: number; updatedAt: string; }

export class AudiobookProgressRepository {
  public constructor(private readonly database: IndexedDbService) {}
  public async get(audiobookId: string): Promise<AudiobookProgress | null> {
    return await this.database.request<AudiobookProgress | undefined>(STORE_NAMES.audiobookProgress, "readonly", store => store.get(audiobookId)) ?? null;
  }
  public async save(value: AudiobookProgress): Promise<void> { await this.database.request(STORE_NAMES.audiobookProgress, "readwrite", store => store.put(value)); }
}
