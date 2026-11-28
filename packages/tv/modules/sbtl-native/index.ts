import { requireNativeModule } from 'expo';

export interface SbtlNativeModule {
  hello(): string;
}
export default requireNativeModule<SbtlNativeModule>('SbtlNative');
