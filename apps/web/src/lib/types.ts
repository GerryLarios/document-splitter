export type Format = 'pdf' | 'epub' | 'cbz' | 'cbr';
export interface Unit {
  id: string;
  index: number;
  title: string;
  excerpt?: string;
  path?: string;
  mime?: string;
}
export type Metadata = Record<string, string>;
export interface BookInfo {
  format: Format;
  name: string;
  size: number;
  units: Unit[];
  metadata: Metadata;
  warnings: string[];
}
export interface Limits {
  fileBytes: number;
  entries: number;
  totalBytes: number;
  entryBytes: number;
  ratio: number;
  units: number;
  imagePixels: number;
}
export const DEFAULT_LIMITS: Limits = {
  fileBytes: 100 * 1024 * 1024,
  entries: 5000,
  totalBytes: 256 * 1024 * 1024,
  entryBytes: 32 * 1024 * 1024,
  ratio: 200,
  units: 10000,
  imagePixels: 40_000_000,
};
export type Progress = (percent: number, message: string) => void;
export type Entries = Record<string, Uint8Array>;
export interface ParsedBook {
  info: BookInfo;
  bytes?: Uint8Array;
  entries?: Entries;
  // Serializable adapter-specific package information. Never sent to the UI.
  epub?: { packagePath: string; version: string; navPath?: string; ncxPath?: string };
}
export interface ExportResult { bytes: Uint8Array; mime: string; extension: 'pdf' | 'epub' | 'cbz'; warnings?: string[] }
export interface PreviewResult { bytes?: Uint8Array; mime?: string; html?: string }
