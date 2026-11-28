// Expo's entry: sets up its runtime first (a full WHATWG URL among other globals), then registers the app as "main".
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
