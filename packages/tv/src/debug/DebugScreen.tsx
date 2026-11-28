import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { runSelfTests } from '../selftest/runner';
import { dbSuite } from '../selftest/db.selftest';
import { filesSuite } from '../selftest/files.selftest';
import { netSuite } from '../selftest/net.selftest';
import { runStickTest } from './run';

// Placeholder: deletable without touching src/platform, src/host or the native module.
export function DebugScreen() {
  const [status, setStatus] = useState('ready');
  const [selfTestOk, setSelfTestOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [frame, setFrame] = useState(0);
  const raf = useRef(0);
  useEffect(() => { const tick = () => { setFrame((f) => (f + 1) % 1000); raf.current = requestAnimationFrame(tick); }; raf.current = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf.current); }, []);
  const selfTest = async () => {
    setBusy(true); setStatus('self-test...');
    const r = await runSelfTests([dbSuite, filesSuite, netSuite]);
    const failed = r.filter((x) => !x.ok);
    setSelfTestOk(failed.length === 0); setBusy(false);
    setStatus(failed.length ? `self-test FAILED: ${failed.map((f) => `${f.suite}/${f.name}: ${f.error}`).join('; ')}` : `self-test passed (${r.length})`);
  };
  const sync = async () => {
    setBusy(true);
    try { await runStickTest(setStatus); } catch (e) { setStatus(`stick test failed: ${(e as Error).message}`); console.log('STICK failed ' + (e as Error).message); }
    setBusy(false);
  };
  const button = (label: string, onPress: () => void, enabled: boolean, first = false) => (
    <Pressable hasTVPreferredFocus={first} disabled={!enabled || busy} onPress={onPress}
      style={({ focused }) => ({ padding: 16, marginRight: 20, borderRadius: 8, backgroundColor: focused ? '#0aa' : '#222', opacity: enabled && !busy ? 1 : 0.4 })}>
      <Text style={{ color: '#fff', fontSize: 20 }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ flex: 1, backgroundColor: '#000', padding: 40 }}>
      <Text style={{ color: '#0cc', fontSize: 28, marginBottom: 20 }}>sbtlTV stick test</Text>
      <View style={{ flexDirection: 'row', marginBottom: 20 }}>{button('Self-test', selfTest, true, true)}{button('Sync everything', sync, selfTestOk)}</View>
      <Text style={{ color: '#fff', fontSize: 18 }}>{status}</Text>
      <Text style={{ color: '#666', fontSize: 14, marginTop: 20 }}>frame {frame}</Text>
    </View>
  );
}
