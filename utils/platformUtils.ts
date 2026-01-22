
import { Capacitor } from '@capacitor/core';

export const isNative = (): boolean => {
  return Capacitor.isNativePlatform();
};

export const getRedirectUri = (): string => {
  if (isNative()) {
    return 'vibelistpro://callback';
  }
  return typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
    ? `${window.location.origin}/`
    : "https://example.com/";
};
