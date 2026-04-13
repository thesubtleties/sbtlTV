/**
 * EPG Parser Web Worker
 * Handles decompression and parsing of XMLTV data off the main thread
 */

import { parseXmltvFull, type XmltvProgram, type XmltvChannel } from '@sbtltv/local-adapter';

export interface EpgWorkerMessage {
  type: 'parse';
  id: number;
  data?: string;        // Raw XML text or base64 gzipped data
  buffer?: Uint8Array;  // Transferred buffer (for large data)
  isBuffer?: boolean;   // True if using buffer instead of string
  isGzipped: boolean;
}

export interface EpgWorkerResponse {
  type: 'result' | 'error';
  id: number;
  programs?: XmltvProgram[];
  channels?: XmltvChannel[];
  error?: string;
}

// Decode base64 to Uint8Array in chunks (avoids atob on huge strings)
function base64ToBytes(base64: string): Uint8Array {
  // Use built-in atob but in manageable chunks to avoid string size limits
  const CHUNK_CHARS = 4 * 256 * 1024; // Must be multiple of 4 for base64
  const chunks: Uint8Array[] = [];
  let totalLen = 0;

  for (let i = 0; i < base64.length; i += CHUNK_CHARS) {
    const slice = base64.slice(i, i + CHUNK_CHARS);
    const bin = atob(slice);
    const bytes = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) {
      bytes[j] = bin.charCodeAt(j);
    }
    chunks.push(bytes);
    totalLen += bytes.length;
  }

  if (chunks.length === 1) return chunks[0];

  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// Decompress gzipped data
async function decompressGzip(base64Data: string): Promise<string> {
  console.log(`[epg-worker] base64ToBytes starting (${Math.round(base64Data.length / 1024 / 1024)}MB)...`);
  const bytes = base64ToBytes(base64Data);
  console.log(`[epg-worker] Got ${Math.round(bytes.length / 1024 / 1024)}MB binary, decompressing...`);

  const ds = new DecompressionStream('gzip');
  const decompressedStream = new Blob([bytes.buffer as ArrayBuffer]).stream().pipeThrough(ds);
  const decompressedBlob = await new Response(decompressedStream).blob();
  console.log(`[epg-worker] Decompressed blob: ${Math.round(decompressedBlob.size / 1024 / 1024)}MB`);
  return await decompressedBlob.text();
}

self.onmessage = async (event: MessageEvent<EpgWorkerMessage>) => {
  const { type, id, data, buffer, isBuffer, isGzipped } = event.data;

  if (type !== 'parse') return;

  try {
    let xmlText: string;

    // Get the data - either from transferred buffer or string
    let inputData: string;
    console.log(`[epg-worker] Received message: isBuffer=${isBuffer}, bufferLen=${buffer?.byteLength}, dataLen=${data?.length}, isGzipped=${isGzipped}`);
    if (isBuffer && buffer) {
      // Decode transferred buffer back to string
      console.log(`[epg-worker] Decoding transferred buffer (${Math.round(buffer.byteLength / 1024 / 1024)}MB)...`);
      const decoder = new TextDecoder();
      inputData = decoder.decode(buffer);
      console.log(`[epg-worker] Decoded to ${Math.round(inputData.length / 1024 / 1024)}MB string`);
    } else if (data) {
      inputData = data;
    } else {
      throw new Error('No data provided');
    }

    if (isGzipped) {
      console.log(`[epg-worker] Decompressing gzipped data (${Math.round(inputData.length / 1024 / 1024)}MB input)...`);
      xmlText = await decompressGzip(inputData);
      console.log(`[epg-worker] Decompressed to ${Math.round(xmlText.length / 1024 / 1024)}MB XML`);
      if (xmlText.length > 0) {
        console.log(`[epg-worker] First 200 chars: ${xmlText.slice(0, 200)}`);
      }
    } else {
      xmlText = inputData;
    }

    console.log(`[epg-worker] Parsing ${Math.round(xmlText.length / 1024 / 1024)}MB XML...`);
    const result = parseXmltvFull(xmlText);
    console.log(`[epg-worker] Parsed: ${result.programs.length} programs, ${result.channels.length} channels`);

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
