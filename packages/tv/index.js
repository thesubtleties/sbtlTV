import { AppRegistry, Text } from 'react-native';
import React from 'react';
import { name as appName } from './app.json';

// Load the app inside a try so a module that throws while loading is reported instead of hiding the registration.
AppRegistry.registerComponent(appName, () => {
  try { return require('./App').default; }
  catch (e) { console.error('APP-LOAD ' + (e && e.stack ? e.stack : String(e))); return () => React.createElement(Text, { style: { color: '#fff' } }, String(e)); }
});
