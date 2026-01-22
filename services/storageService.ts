
import { Preferences } from '@capacitor/preferences';
import { isNative } from '../utils/platformUtils';

export const storageService = {
  async setItem(key: string, value: string): Promise<void> {
    if (isNative()) {
      await Preferences.set({ key, value });
    } else {
      localStorage.setItem(key, value);
    }
  },

  async getItem(key: string): Promise<string | null> {
    if (isNative()) {
      const { value } = await Preferences.get({ key });
      return value;
    } else {
      return localStorage.getItem(key);
    }
  },

  async removeItem(key: string): Promise<void> {
    if (isNative()) {
      await Preferences.remove({ key });
    } else {
      localStorage.removeItem(key);
    }
  }
};
