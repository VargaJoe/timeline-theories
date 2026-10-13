export function bindSnAuthStorage(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, profile: { repositoryUrl: string; authority: string; clientId: string }): void;
