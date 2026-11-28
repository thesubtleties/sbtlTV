import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { openDatabaseSync } from 'expo-sqlite';
import { normalizeTitle } from '@sbtltv/core';
import { STAGING_BATCH } from '@sbtltv/data';
import SbtlNative from './modules/sbtl-native';

export default function App() {
  const [out, setOut] = useState('...');
  useEffect(() => {
    const db = openDatabaseSync('smoke.sqlite');
    const v = db.getFirstSync<{ v: string }>('select sqlite_version() v')!.v;
    const opts = db.getAllSync<{ compile_options: string }>('pragma compile_options').map((r) => r.compile_options);
    const r = { sqlite: v, fts5: opts.includes('ENABLE_FTS5'), json1: db.getFirstSync('select json(\'[1]\') j') != null,
      tempStore: opts.find((o) => o.startsWith('TEMP_STORE')), norm: normalizeTitle('4K-EN - Heat (1995)'), batch: STAGING_BATCH,
      native: SbtlNative.hello(), nfc: 'é'.normalize('NFD').length };
    console.log('SMOKE ' + JSON.stringify(r));
    setOut(JSON.stringify(r, null, 1));
  }, []);
  return <View style={{ flex: 1, backgroundColor: '#000', padding: 40 }}><Text style={{ color: '#fff', fontSize: 18 }}>{out}</Text></View>;
}
