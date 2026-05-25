let hasWarnedStorageFailure = false;

const warnStorageFailure = (action: string, error: unknown) => {
  if (hasWarnedStorageFailure && !import.meta.env.DEV) {
    return;
  }

  hasWarnedStorageFailure = true;
  console.warn(`localStorage ${action} failed:`, error);
};

export const storageGetItem = (key: string) => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    warnStorageFailure("read", error);
    return null;
  }
};

export const storageSetItem = (key: string, value: string) => {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (error) {
    warnStorageFailure("write", error);
    return false;
  }
};

export const storageRemoveItem = (key: string) => {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    window.localStorage.removeItem(key);
    return true;
  } catch (error) {
    warnStorageFailure("remove", error);
    return false;
  }
};

export const storageKeys = () => {
  if (typeof window === "undefined") {
    return [] as string[];
  }

  try {
    return Object.keys(window.localStorage);
  } catch (error) {
    warnStorageFailure("enumerate", error);
    return [] as string[];
  }
};
