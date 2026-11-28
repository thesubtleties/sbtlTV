import { randomUUID } from 'expo-crypto';
import type { Platform } from '@sbtltv/data';
import SbtlNative from '../../modules/sbtl-native';
import { openRnDb } from './db';
import { rnFiles } from './files';
import { makeNet } from './net';
import { makeGunzip } from './gunzip';

export function rnPlatform(): Platform {
  const files = rnFiles();
  return { openDb: openRnDb, files, net: makeNet(SbtlNative, files), gunzip: makeGunzip(SbtlNative, files), uuid: () => randomUUID() };
}
