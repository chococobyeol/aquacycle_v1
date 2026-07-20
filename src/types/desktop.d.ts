export {};

declare global {
  interface Window {
    aquacycleDesktop?: {
      platform: string;
      versions: {
        chrome: string;
        electron: string;
      };
    };
  }
}
