import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { runSelfTests } from './src/selftest/runner';
import { dbSuite } from './src/selftest/db.selftest';
import { filesSuite } from './src/selftest/files.selftest';

// Temporary: runs the self-tests at start (the debug screen in Task 7 replaces this).
export default function App() {
  const [out, setOut] = useState('running self-tests...');
  useEffect(() => { runSelfTests([dbSuite, filesSuite]).then((r) => setOut(r.map((x) => `${x.ok ? 'ok  ' : 'FAIL'} ${x.suite}/${x.name}${x.error ? ' - ' + x.error : ''}`).join('\n'))); }, []);
  return <View style={{ flex: 1, backgroundColor: '#000', padding: 40 }}><Text style={{ color: '#fff', fontSize: 16 }}>{out}</Text></View>;
}
