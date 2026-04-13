/**
 * EPG Parser Web Worker
 * Parses plain XMLTV text off the main thread.
 * Gzipped files are handled by the main process worker thread instead.
 */

import { parseXmltvFull, type XmltvProgram, type XmltvChannel } from '@sbtltv/local-adapter';

export interface EpgWorkerMessage {
  type: 'parse';
  id: number;
  data: string;
}

export interface EpgWorkerResponse {
  type: 'result' | 'error';
  id: number;
  programs?: XmltvProgram[];
  channels?: XmltvChannel[];
  error?: string;
}

self.onmessage = async (event: MessageEvent<EpgWorkerMessage>) => {
  const { type, id, data } = event.data;

  if (type !== 'parse') return;

  try {
    const result = parseXmltvFull(data);

    self.postMessage({
      type: 'result',
      id,
      programs: result.programs,
      channels: result.channels,
    } as EpgWorkerResponse);
  } catch (err) {
    self.postMessage({
      type: 'error',
      id,
      error: err instanceof Error ? err.message : String(err),
    } as EpgWorkerResponse);
  }
};
