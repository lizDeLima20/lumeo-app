import { IndexedDbService, STORE_NAMES } from "../services/IndexedDbService";

interface StoredAudiobookFile { audiobookId: string; blob: Blob; savedAt: string; }

/** Full chapters requested by the listener. Metadata listings never write here. */
export class AudiobookFileRepository {
  public constructor(private readonly database: IndexedDbService) {}
  public async save(audiobookId: string, file: Blob): Promise<void> {
    await this.database.request(STORE_NAMES.audiobookFiles, "readwrite", store => store.put({ audiobookId, blob: file, savedAt: new Date().toISOString() } satisfies StoredAudiobookFile));
  }
  public async get(audiobookId: string): Promise<Blob | null> {
    return (await this.database.request<StoredAudiobookFile | undefined>(STORE_NAMES.audiobookFiles, "readonly", store => store.get(audiobookId)))?.blob ?? null;
  }
  public async exists(audiobookId: string): Promise<boolean> {
    return (await this.database.request<IDBValidKey | undefined>(STORE_NAMES.audiobookFiles, "readonly", store => store.getKey(audiobookId))) !== undefined;
  }
  public async delete(audiobookId: string): Promise<void> { await this.database.request(STORE_NAMES.audiobookFiles, "readwrite", store => store.delete(audiobookId)); }
}
