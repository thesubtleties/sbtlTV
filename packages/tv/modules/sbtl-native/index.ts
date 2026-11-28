import { requireNativeModule } from 'expo';
export interface FetchResult { status: number; location: string | null; bytes: number }
export interface SbtlNativeModule {
  hello(): string;
  fetchToFile(url: string, dest: string, maxBytes: number): Promise<FetchResult>;
  gunzipFile(src: string, dest: string, maxBytes: number): Promise<void>;
  memoryInfo(): { pssKb: number; rssKb: number; freeDiskBytes: number };
}
export default requireNativeModule<SbtlNativeModule>('SbtlNative');
