export interface Profile {repositoryUrl:string;authority:string;authType:'SNAuth'|'IdentityServer';clientId:string;projectRoot:string;writable:boolean;mode:string}
export function validateProfile(profile: Omit<Profile,'mode'>,mode:string): Profile;
export function readProfile(mode:string,basePath:string):Profile;
